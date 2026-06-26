// publish-delivery —— 已验证交付 → 自动建分支/commit/push + 发布后远程确定性核验（不建 PR）
//
// 定位：消费 deliver-from-plan 的【已验证交付目录】（changes.diff + delivery-manifest，finalStatus∈
//   {DELIVERED, DELIVERED_WITH_OPEN_ITEMS}），把变更落地到目标仓库远程的一个分支并 push。
//   交付执行模型=【clone 远程 → 应用已验证 diff → 落地分支 → push】：原目标仓库工作区零改动；git 写操作
//   全部发生在隔离的发布工作副本里，并由独立只读核验阶段以远程事实背书（不信执行者自报）。设计真相源见
//   docs/12 的下游延伸与「全自动AI软件交付流水线-分析与改造方案.md」第 8/9 节。
//
// 安全铁律（与全局规则 6/8/16 一致）：绝不 force-push；默认禁止直接 push main/master/release（需显式
//   allowMainPush）；高风险域（支付/权限/密钥/认证/不可逆）默认人工闸门、不自动发布；绝不提交 .env/密钥/
//   个人 harness 配置；脚本体不含任何凭据（push 依赖环境已配置的 SSH/credential helper）。
//
// 运行：
//   Workflow({ scriptPath: ".../.claude/workflows/publish-delivery.js", args: {
//     deliveryDir: "<deliver-from-plan 的交付目录，必填>",
//     targetRepo: "<目标仓库本地路径；省略则取 delivery-manifest.targetRepo>",
//     remoteUrl: "<要 push 的 git 远程；省略则取 targetRepo 的 origin>",
//     gitPolicy: { branchMode: "new-branch|direct", branchPrefix: "ai/", targetBranch: "main",
//                  allowMainPush: false, pushRemote: "origin" },
//     authorName: "<提交者名；省略则用环境 git 身份>", authorEmail: "<提交者邮箱>",
//     commitMessage: "<覆盖默认提交信息>",
//     coAuthoredBy: "<可选；传 '名 <email>' 则在默认提交信息追加 Co-Authored-By 行；省略则不署任何模型名（保持模型无关）>",
//     allowHighRiskAutoPublish: false,   // 高风险域是否允许自动发布（默认 false=人工闸门）
//     dryRun: false,                     // true=准备分支/提交但不真正 push
//     outDir: "evidence/publishes"
//   }})
// 运行时事实：args 到脚本是 JSON 字符串需 parse；脚本体无文件系统访问与时间/随机 API，一切 IO 与时间戳经子代理。

export const meta = {
  name: 'publish-delivery',
  description: '已验证交付 → 自动建分支/commit/push + 发布后远程确定性核验（不建 PR）。clone 远程→应用已验证 diff→落地分支→push→独立核验远程。绝不 force、默认禁直推 main、高风险人工闸门、绝不提交密钥。',
  whenToUse: '已有一份 deliver-from-plan 产出的、finalStatus 为 DELIVERED / DELIVERED_WITH_OPEN_ITEMS 的交付（含通过 apply-check 的 changes.diff），希望自动把它发布到目标仓库远程的一个分支（不建 PR），且要求发布结果可被独立核验时',
  phases: [
    { title: 'Preflight', detail: '读 delivery-manifest，确定性发布闸门：可发布态 + apply-check + 高风险/分支策略 + 解析远程 + 客户发布方式选择（未选停于 PUBLISH_NEEDS_CHOICE，不 commit/push）' },
    { title: 'Clone', detail: 'clone 远程到隔离发布工作副本（保留 .git，原仓库零改动）' },
    { title: 'Branch', detail: '据策略建分支（默认新特性分支；禁直推 main/master/release 除非 allowMainPush）' },
    { title: 'Apply', detail: 'git apply 已验证 changes.diff；核对变更文件与交付一致' },
    { title: 'Commit', detail: '以指定身份提交；拒绝暂存 .env/密钥/个人配置等禁入文件' },
    { title: 'Push', detail: 'git push 到分支（绝不 force；dryRun 则跳过）' },
    { title: 'RemoteVerify', detail: '独立只读核验：远程分支 SHA(git ls-remote)==本地提交、提交文件==交付、无禁入文件、发布副本本地工作树干净' },
    { title: 'Finalize', detail: '写 final-delivery.json + 报告到带时间戳目录' },
  ],
}

// ===================== 参数（args 为 JSON 字符串，先 parse）=====================
const A = (() => {
  let a = args
  if (typeof a === 'string') { try { a = a.trim() ? JSON.parse(a) : {} } catch (e) { a = {} } }
  return (a && typeof a === 'object') ? a : {}
})()
const deliveryDir = A.deliveryDir ? String(A.deliveryDir) : null
const targetRepoArg = A.targetRepo ? String(A.targetRepo) : null
const remoteUrlArg = A.remoteUrl ? String(A.remoteUrl) : null
const outDirBase = A.outDir ? String(A.outDir) : 'evidence/publishes'
const authorName = A.authorName ? String(A.authorName) : null
const authorEmail = A.authorEmail ? String(A.authorEmail) : null
const commitMessageArg = A.commitMessage ? String(A.commitMessage) : null
const coAuthoredBy = A.coAuthoredBy ? String(A.coAuthoredBy) : null   // 可选模型/协作者署名；省略则默认提交信息不含 Co-Authored-By（保持模型无关，避免错误归属）
// L1 模型分层：纯 git plumbing/落盘类 agent（clone、push、写报告）用轻模型省成本；安全/验证类（apply 查越界、commit 查禁入、远程核验）一律留默认强模型。可经 args.lightModel 覆盖。
const LIGHT_MODEL = ['haiku', 'sonnet', 'opus', 'fable'].includes(String(A.lightModel)) ? String(A.lightModel) : 'haiku'
const allowHighRiskAutoPublish = !!A.allowHighRiskAutoPublish
const dryRun = !!A.dryRun
const GP = (A.gitPolicy && typeof A.gitPolicy === 'object') ? A.gitPolicy : {}
// 客户必须显式选择发布方式（gitPolicy.branchMode："new-branch"=新建分支后提交推送 / "direct"=当前分支直接提交推送）；
// 未显式选择则在 Preflight 停于 PUBLISH_NEEDS_CHOICE，不执行 commit/push（受保护分支/高风险/禁强推规则不变）。
const branchChoiceRaw = GP.branchMode ? String(GP.branchMode).toLowerCase() : ''
const branchChoiceProvided = branchChoiceRaw === 'new-branch' || branchChoiceRaw === 'direct'
const branchMode = branchChoiceProvided ? branchChoiceRaw : 'new-branch'   // 安全缺省仅供代码路径；未选择时不会走到使用它的分支
const branchPrefix = GP.branchPrefix ? String(GP.branchPrefix) : 'ai/'
const targetBranch = GP.targetBranch ? String(GP.targetBranch) : null
const allowMainPush = !!GP.allowMainPush
const pushRemote = GP.pushRemote ? String(GP.pushRemote) : 'origin'

const AT = 'general-purpose'   // 全工具内置 agentType（需 Read/Bash/Write），任意目录可跑
const PROTECTED = ['main', 'master', 'release']   // 受保护分支名前缀（需 allowMainPush 才放行）

// ===================== 执行辅助 =====================
const execLog = []
function note(m) { execLog.push(m); log(m) }
async function callAgent(prompt, opts, required) {
  const attempts = required ? 2 : 1
  let lastErr = null
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await agent(prompt, opts)
      if (r !== null && r !== undefined) return { ok: true, value: r }
      lastErr = 'agent 返回 null（跳过/终态失败）'
    } catch (e) { lastErr = String((e && e.message) || e).slice(0, 200) }
    if (i < attempts - 1) note(`  · ${opts.label} 第 ${i + 1} 次失败：${lastErr} → 重试`)
  }
  return { ok: false, error: lastErr }
}
function halt(stage, reason, status) { const e = new Error(`HALT@${stage}: ${reason}`); e.__halt = { stage, reason, status: status || 'FAILED' }; throw e }
function isProtectedBranchName(name) { const n = String(name || '').toLowerCase(); return PROTECTED.some(p => n === p || n.startsWith(p + '/')) }

// >>> PUBLISH-STATUS-START — 与 core/publish-status.mjs 同一逻辑（行为由 scripts/self-check.mjs 比对锁定，单测见 scripts/publish-status.test.mjs）；勿删本标记与 END 标记
// 确定性发布终态：PUBLISH_BLOCKED 短路；唯有"已 push 且远程核验全过"才给 PUBLISHED；dryRun/未核验各有专属态
function computePublishStatus(input) {
  const i = input || {}
  const reasons = []
  if (i.priorStatus === 'PUBLISH_BLOCKED') return { finalStatus: 'PUBLISH_BLOCKED', reasons }
  // customer must explicitly choose the branch mode before any commit/push; absence stops here, not BLOCKED
  if (i.priorStatus === 'PUBLISH_NEEDS_CHOICE') return { finalStatus: 'PUBLISH_NEEDS_CHOICE', reasons }

  if (i.highRiskBlocked) { reasons.push('高风险域（支付/权限/密钥/认证/不可逆）默认人工闸门，不自动发布。'); return { finalStatus: 'PUBLISH_BLOCKED', reasons } }

  const ok = ['DELIVERED', 'DELIVERED_WITH_OPEN_ITEMS']
  if (!ok.includes(i.deliverableStatus)) { reasons.push('上游交付未达可发布态（需 DELIVERED / DELIVERED_WITH_OPEN_ITEMS），拒绝发布。'); return { finalStatus: 'PUBLISH_BLOCKED', reasons } }
  if (i.diffApplyCheckPassed !== true) { reasons.push('交付 diff 未通过 git apply --check，拒绝发布。'); return { finalStatus: 'PUBLISH_BLOCKED', reasons } }
  if (i.branchAllowed === false) { reasons.push('目标分支不被策略允许（默认禁止直接 push main/master/release；需显式 allowMainPush）。'); return { finalStatus: 'PUBLISH_BLOCKED', reasons } }

  if (i.dryRun === true) { reasons.push('dryRun：已准备分支/提交，但按要求未实际 push。'); return { finalStatus: 'PUBLISH_DRYRUN', reasons } }
  if (i.pushPerformed !== true) { reasons.push('push 未成功执行（凭据缺失/被拒/网络），未发布。'); return { finalStatus: 'PUBLISH_BLOCKED', reasons } }

  const rv = i.remoteVerified || null
  const remoteOk = !!(rv && rv.branchShaMatches === true && rv.committedFilesMatch === true && rv.noForbiddenFiles === true && rv.workTreeClean === true)
  if (!remoteOk) { reasons.push('发布后远程核验未全过（远程SHA/提交文件/禁入文件/工作树 之一不符），不宣称成功。'); return { finalStatus: 'PUBLISH_UNVERIFIED', reasons } }

  const open = Array.isArray(i.deliverableOpenItems) ? i.deliverableOpenItems : []
  return { finalStatus: open.length > 0 ? 'PUBLISHED_WITH_OPEN_ITEMS' : 'PUBLISHED', reasons }
}
// <<< PUBLISH-STATUS-END

const SAFETY = `【硬安全约束】(1) 只在隔离的发布工作副本里操作，绝不修改原目标仓库 ${targetRepoArg || '(交付 manifest 的目标仓库)'} 的工作区或历史；(2) 绝不 git push --force/-f、绝不 reset --hard 远程、绝不删远程分支、绝不改写历史；(3) 绝不 git add/commit 任何 .env/.env.*/*.key/*.pem/*.p12/*.pfx/id_rsa*/凭据/密钥，以及 .claude/settings.local.json、AGENTS.md、个人 harness 配置；(4) 命中支付/权限/密钥/认证/不可逆操作即停并报告。中文输出，只返回结构化结果。`

// ===================== Schemas =====================
const PREFLIGHT_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  deliverableStatus: { type: 'string', description: 'delivery-manifest.finalStatus' },
  diffApplyCheckPassed: { type: 'boolean', description: 'delivery-manifest.diffApplyCheckPassed' },
  diffPresent: { type: 'boolean', description: 'deliveryDir/changes.diff 是否存在且非空' },
  manifestFilesChanged: { type: 'array', items: { type: 'string' }, description: 'delivery-manifest.filesChanged（target-root-relative）' },
  requirementGoal: { type: 'string' },
  targetRepo: { type: 'string' }, remoteUrl: { type: 'string', description: '要 push 的远程；解析不到则空串' },
  remoteReachable: { type: 'boolean', description: 'git ls-remote 能否连通该远程' },
  defaultBranch: { type: 'string' },
  highRiskDomains: { type: 'array', items: { type: 'string' }, description: '从 risks.json/manifest 识别的高风险域（支付/权限/密钥/认证/不可逆等）；无则空数组' },
  openItems: { type: 'array', items: { type: 'string' }, description: 'delivery-manifest.openItems' },
  note: { type: 'string' },
}, required: ['deliverableStatus', 'diffApplyCheckPassed', 'diffPresent', 'manifestFilesChanged', 'requirementGoal', 'targetRepo', 'remoteUrl', 'remoteReachable', 'defaultBranch', 'highRiskDomains', 'openItems', 'note'] }

const CLONE_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  ok: { type: 'boolean' }, publishDir: { type: 'string' }, repoDir: { type: 'string' },
  defaultBranch: { type: 'string' }, cloneClean: { type: 'boolean', description: 'clone 后工作树是否干净' }, note: { type: 'string' },
}, required: ['ok', 'publishDir', 'repoDir', 'defaultBranch', 'cloneClean', 'note'] }

const BRANCH_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  ok: { type: 'boolean' }, branchName: { type: 'string' }, createdFrom: { type: 'string' },
  isNewBranch: { type: 'boolean', description: '是否新建分支（false=直接用已存在分支，如 direct 模式的 main）' }, note: { type: 'string' },
}, required: ['ok', 'branchName', 'createdFrom', 'isNewBranch', 'note'] }

const APPLY_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  ok: { type: 'boolean' }, appliedFiles: { type: 'array', items: { type: 'string' } },
  unexpectedFiles: { type: 'array', items: { type: 'string' }, description: '应用后变更但不在交付 filesChanged 内的文件（应空）' },
  conflicts: { type: 'array', items: { type: 'string' } }, note: { type: 'string' },
}, required: ['ok', 'appliedFiles', 'unexpectedFiles', 'conflicts', 'note'] }

const COMMIT_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  ok: { type: 'boolean' }, commitSha: { type: 'string' }, committedFiles: { type: 'array', items: { type: 'string' } },
  forbiddenStaged: { type: 'array', items: { type: 'string' }, description: '被拦下的禁入文件（.env/密钥/个人配置等，应空）' },
  authorLine: { type: 'string', description: '实际提交者 name <email>' }, note: { type: 'string' },
}, required: ['ok', 'commitSha', 'committedFiles', 'forbiddenStaged', 'authorLine', 'note'] }

const PUSH_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  ok: { type: 'boolean' }, pushPerformed: { type: 'boolean', description: '是否真正执行并被远程接受（dryRun/失败=false）' },
  pushRejected: { type: 'boolean', description: '是否被远程拒绝（凭据/权限/非快进等）' },
  remoteRef: { type: 'string', description: 'refs/heads/<branch>' }, pushUrlSafe: { type: 'string', description: '不含任何凭据的远程 URL' }, note: { type: 'string' },
}, required: ['ok', 'pushPerformed', 'pushRejected', 'remoteRef', 'pushUrlSafe', 'note'] }

const REMOTEVERIFY_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  branchShaMatches: { type: 'boolean', description: 'git ls-remote 的分支 SHA == 本地提交 SHA' },
  committedFilesMatch: { type: 'boolean', description: '本次提交实际改动文件 == 交付 filesChanged（多一个少一个都为 false）' },
  noForbiddenFiles: { type: 'boolean', description: '提交内不含 .env/密钥/个人配置等禁入文件' },
  workTreeClean: { type: 'boolean', description: 'git status --porcelain 为空' },
  remoteSha: { type: 'string' }, remoteFiles: { type: 'array', items: { type: 'string' } }, note: { type: 'string' },
}, required: ['branchShaMatches', 'committedFilesMatch', 'noForbiddenFiles', 'workTreeClean', 'remoteSha', 'remoteFiles', 'note'] }

const FINALIZE_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  ok: { type: 'boolean' }, absOutDir: { type: 'string' }, written: { type: 'array', items: { type: 'string' } }, note: { type: 'string' },
}, required: ['ok', 'absOutDir', 'written', 'note'] }

// ===================== 状态收集 =====================
let finalStatus = 'FAILED'
let pre = null, clone = null, branch = null, apply = null, commit = null, push = null, remoteVerify = null, finalize = null
let halted = false, branchAllowed = null, highRiskBlocked = null
const failedStages = []

try {
  if (!deliveryDir) halt('Preflight', 'args.deliveryDir 缺失（必填）')

  // ---- Preflight：读交付 manifest + 解析远程 + 高风险/可发布闸门 ----
  phase('Preflight')
  const pf = await callAgent(
    `你是只读分析者，为"自动发布"做前置取证。${SAFETY}\n` +
    `读取交付目录 ${deliveryDir}：delivery-manifest.json（必读）与 changes.diff（确认存在且非空）。如存在再看 task-workflow/input/risks.json、requirement.json。\n` +
    `回报：deliverableStatus(=manifest.finalStatus)、diffApplyCheckPassed(=manifest.diffApplyCheckPassed)、diffPresent(changes.diff 是否存在且非空)、manifestFilesChanged(=manifest.filesChanged 原样)、requirementGoal(=manifest.gate.requirementGoal 或 requirement.json.goal)、targetRepo(=${targetRepoArg || 'manifest.targetRepo'})、` +
    `remoteUrl(${remoteUrlArg ? '=' + remoteUrlArg : '用 Bash 取 targetRepo 的远程：git -C <targetRepo> remote get-url ' + pushRemote + '；取不到则空串'})、remoteReachable(git ls-remote 能否连通 remoteUrl；空串则 false)、defaultBranch(远程默认分支，如 git -C <targetRepo> symbolic-ref refs/remotes/' + pushRemote + '/HEAD 或 ls-remote --symref；取不到填 "main")、` +
    `highRiskDomains(扫描 risks.json 高危项与 manifest.redLine：命中 支付/payment/金额、权限/permission、密钥/secret/key、认证/auth/login、不可逆/删库/migration 的域名列表；无则空数组)、openItems(=manifest.openItems)。不要改任何文件、不要 clone。`,
    { schema: PREFLIGHT_SCHEMA, label: 'publish-preflight', phase: 'Preflight', agentType: AT, effort: 'low' }, true)
  if (!pf.ok) { failedStages.push('Preflight'); halt('Preflight', pf.error) }
  pre = pf.value
  const targetRepo = targetRepoArg || pre.targetRepo
  const remoteUrl = remoteUrlArg || pre.remoteUrl
  highRiskBlocked = (pre.highRiskDomains || []).length > 0 && !allowHighRiskAutoPublish
  const publishable = ['DELIVERED', 'DELIVERED_WITH_OPEN_ITEMS'].includes(pre.deliverableStatus) && pre.diffApplyCheckPassed === true && pre.diffPresent === true
  note(`发布闸门：交付态=${pre.deliverableStatus}，apply-check=${pre.diffApplyCheckPassed}，diff在=${pre.diffPresent} → 可发布=${publishable}；远程=${remoteUrl || '(未解析到)'}（可达=${pre.remoteReachable}）；高风险域=${(pre.highRiskDomains || []).join('/') || '无'}${highRiskBlocked ? '→人工闸门拦截' : ''}。`)
  if (highRiskBlocked) { finalStatus = 'PUBLISH_BLOCKED'; note('⛔ 命中高风险域且未开 allowHighRiskAutoPublish：默认人工闸门，不自动发布。如确需自动发布，请人工复核后传 allowHighRiskAutoPublish:true。') }
  else if (!publishable) { finalStatus = 'PUBLISH_BLOCKED'; note('⛔ 上游交付未达可发布态（需 DELIVERED/带开环项 + apply-check 通过 + diff 存在），拒绝发布。') }
  else if (!remoteUrl) { finalStatus = 'PUBLISH_BLOCKED'; note('⛔ 解析不到要 push 的远程（targetRepo 无 origin 且未传 remoteUrl），无处可发。请传 args.remoteUrl。') }
  else if (!pre.remoteReachable) { finalStatus = 'PUBLISH_BLOCKED'; note('⛔ 远程不可达（网络或凭据问题），无法发布。') }
  else if (!branchChoiceProvided) { finalStatus = 'PUBLISH_NEEDS_CHOICE'; note('⏸ 需客户先选择发布方式，未明确选择前【不执行 commit/push】：(1) 新建分支后提交并推送 → 传 gitPolicy.branchMode="new-branch"；(2) 当前分支直接提交并推送 → 传 gitPolicy.branchMode="direct"。请带选择重跑发布。受保护分支/高风险/禁强推规则不变。') }
  else {

    // ---- Clone：clone 远程到隔离发布工作副本（保留 .git）----
    phase('Clone')
    const cl = await callAgent(
      `你负责建立隔离的发布工作副本。${SAFETY}\n` +
      `步骤(用 Bash，绝不动原仓库)：1) ts=$(date +%Y%m%d-%H%M%S)；publishDir="${outDirBase}/$ts"；mkdir -p "$publishDir"；用 realpath 取绝对路径。\n` +
      `2) clone 远程（保留完整 .git）：git clone "${remoteUrl}" "$publishDir/repo"。若 ${remoteUrl} 是本地路径，用 git clone --local。clone 用环境已配置的凭据，不要在命令行内联任何 token。\n` +
      `3) 进入 repo，确认默认分支(git branch --show-current 或 git rev-parse --abbrev-ref HEAD)、工作树干净(git status --porcelain 为空)。\n` +
      `回报 ok/publishDir(绝对)/repoDir(绝对,=publishDir/repo)/defaultBranch/cloneClean/note。`,
      { schema: CLONE_SCHEMA, label: 'clone-repo', phase: 'Clone', agentType: AT, effort: 'low', model: LIGHT_MODEL }, true)
    if (!cl.ok) { failedStages.push('Clone'); halt('Clone', cl.error, 'PUBLISH_BLOCKED') }
    clone = cl.value
    if (!clone.ok || !clone.repoDir) { finalStatus = 'PUBLISH_BLOCKED'; note('clone 失败，无法发布：' + clone.note); halt('Clone', 'clone 未成功', 'PUBLISH_BLOCKED') }
    note(`Clone：repoDir=${clone.repoDir}，默认分支=${clone.defaultBranch}，干净=${clone.cloneClean}。`)

    // ---- Branch：据策略建分支（受保护分支需 allowMainPush）----
    phase('Branch')
    const baseBranch = targetBranch || clone.defaultBranch || pre.defaultBranch || 'main'
    const br = await callAgent(
      `你负责在发布副本 ${clone.repoDir} 里准备目标分支。${SAFETY}\n` +
      (branchMode === 'direct'
        ? `策略=direct（直接用已存在分支）：checkout 分支 "${baseBranch}"（git checkout ${baseBranch}），确保与 ${pushRemote}/${baseBranch} 对齐。branchName="${baseBranch}"，isNewBranch=false，createdFrom="${baseBranch}"。\n`
        : `策略=new-branch（新建特性分支）：先 checkout 基分支 "${baseBranch}"；ts=$(date +%Y%m%d-%H%M%S)；用需求目标生成简短 slug（小写、空格转-、去特殊字符、≤40字符）；branchName="${branchPrefix}<slug>-$ts"；git checkout -b "$branchName"。isNewBranch=true，createdFrom="${baseBranch}"。需求目标：${pre.requirementGoal}\n`) +
      `回报 ok/branchName(实际分支名)/createdFrom/isNewBranch/note。`,
      { schema: BRANCH_SCHEMA, label: 'prepare-branch', phase: 'Branch', agentType: AT, effort: 'low' }, true)
    if (!br.ok) { failedStages.push('Branch'); halt('Branch', br.error, 'PUBLISH_BLOCKED') }
    branch = br.value
    // 确定性分支策略闸门（纯 JS）：受保护分支名需 allowMainPush
    branchAllowed = !(isProtectedBranchName(branch.branchName) && !allowMainPush)
    note(`Branch：${branch.branchName}（${branch.isNewBranch ? '新建' : '复用'}，自 ${branch.createdFrom}）；受保护名=${isProtectedBranchName(branch.branchName)} → 策略允许=${branchAllowed}。`)
    if (!branchAllowed) { finalStatus = 'PUBLISH_BLOCKED'; note(`⛔ 目标分支 ${branch.branchName} 是受保护分支（main/master/release），默认禁止直推；如确需，请传 gitPolicy.allowMainPush:true。已停在 push 前。`) }
    else {

      // ---- Apply：应用已验证 diff，核对变更文件 ----
      phase('Apply')
      const ap = await callAgent(
        `你负责把【已验证的交付 diff】应用到发布副本 ${clone.repoDir}。${SAFETY}\n` +
        `1) 在 repo 根执行：git apply --index "${deliveryDir}/changes.diff"（该 diff 是 target-root-relative、已通过 apply-check）。若有冲突/失败，如实记入 conflicts、ok=false，不要强行改写。\n` +
        `2) 用 git diff --cached --name-only 列出已暂存变更文件 appliedFiles；与交付声明的变更文件 ${JSON.stringify(pre.manifestFilesChanged)} 对账：列出 unexpectedFiles(应用后变更但不在交付清单内的，应空)。\n` +
        `回报 ok/appliedFiles/unexpectedFiles/conflicts/note。`,
        { schema: APPLY_SCHEMA, label: 'apply-diff', phase: 'Apply', agentType: AT, effort: 'medium' }, true)
      if (!ap.ok) { failedStages.push('Apply'); halt('Apply', ap.error, 'PUBLISH_BLOCKED') }
      apply = ap.value
      if (!apply.ok || (apply.conflicts || []).length) { finalStatus = 'PUBLISH_BLOCKED'; note(`⛔ diff 应用失败/冲突：${(apply.conflicts || []).join('; ') || apply.note}`); halt('Apply', 'diff 应用失败', 'PUBLISH_BLOCKED') }
      if ((apply.unexpectedFiles || []).length) { finalStatus = 'PUBLISH_BLOCKED'; note(`⛔ 应用后出现交付清单外的变更：${apply.unexpectedFiles.join(', ')}，拒绝发布。`); halt('Apply', '变更超出交付清单', 'PUBLISH_BLOCKED') }
      note(`Apply：已应用 ${apply.appliedFiles.length} 文件（${apply.appliedFiles.join(', ')}），无清单外变更。`)

      // ---- Commit：以指定身份提交；拦截禁入文件 ----
      phase('Commit')
      const idLine = (authorName && authorEmail) ? `${authorName} <${authorEmail}>` : '(环境 git 身份)'
      const coAuthorLine = coAuthoredBy ? `\n\nCo-Authored-By: ${coAuthoredBy}` : ''   // 默认不署模型名，避免错误归属/与 Codex 等适配不一致
      const defaultMsg = `${pre.requirementGoal || '自动交付'}\n\n由 publish-delivery 自动发布：应用经独立验证的交付 diff（来源 ${deliveryDir}）。\n变更文件：${(pre.manifestFilesChanged || []).join(', ')}。${(pre.openItems || []).length ? '\n开环项：' + pre.openItems.length + ' 项（见交付报告）。' : ''}${coAuthorLine}`
      const commitMessage = commitMessageArg || defaultMsg
      const cm = await callAgent(
        `你负责在发布副本 ${clone.repoDir} 提交本次变更。${SAFETY}\n` +
        ((authorName && authorEmail) ? `1) 设置提交身份：git config user.name "${authorName}"；git config user.email "${authorEmail}"。\n` : `1) 使用环境已配置的 git user.name/user.email（不覆盖）。\n`) +
        `2) 暂存前禁入核查：确认暂存区不含 .env/.env.*/*.key/*.pem/*.p12/*.pfx/id_rsa*/*credential*/*secret*、.claude/settings.local.json、AGENTS.md 等禁入文件；命中则 git reset 取消其暂存并记入 forbiddenStaged。只提交 diff 应用产生的 SCOPE 变更。\n` +
        `3) 提交：git commit 用如下信息（原样、逐字，勿增删署名行）：\n<<<MSG\n${commitMessage}\nMSG\n` +
        `4) 取 commitSha=git rev-parse HEAD；committedFiles=git show --stat --name-only --pretty=format: HEAD；authorLine=git show -s --format='%an <%ae>' HEAD。\n` +
        `回报 ok/commitSha/committedFiles/forbiddenStaged(被拦下的,应空)/authorLine/note。期望提交者=${idLine}。`,
        { schema: COMMIT_SCHEMA, label: 'commit', phase: 'Commit', agentType: AT, effort: 'medium' }, true)
      if (!cm.ok) { failedStages.push('Commit'); halt('Commit', cm.error, 'PUBLISH_BLOCKED') }
      commit = cm.value
      if (!commit.ok || !commit.commitSha) { finalStatus = 'PUBLISH_BLOCKED'; note('提交失败：' + commit.note); halt('Commit', '提交失败', 'PUBLISH_BLOCKED') }
      if ((commit.forbiddenStaged || []).length) { finalStatus = 'PUBLISH_BLOCKED'; note(`⛔ 检出禁入文件被暂存（已拦截不提交，但停止发布以人工核查）：${commit.forbiddenStaged.join(', ')}`); halt('Commit', '禁入文件', 'PUBLISH_BLOCKED') }
      note(`Commit：${commit.commitSha.slice(0, 9)} by ${commit.authorLine}；提交文件 ${commit.committedFiles.join(', ')}。`)

      // ---- Push：git push 到分支（绝不 force；dryRun 跳过）----
      phase('Push')
      if (dryRun) {
        push = { ok: true, pushPerformed: false, pushRejected: false, remoteRef: `refs/heads/${branch.branchName}`, pushUrlSafe: remoteUrl, note: 'dryRun：未实际 push' }
        note('Push：dryRun=true，已准备好提交但未 push。')
      } else {
        const pu = await callAgent(
          `你负责把分支推到远程（绝不 force、绝不改写历史）。${SAFETY}\n` +
          `在 ${clone.repoDir} 执行：git push ${pushRemote} "${branch.branchName}"（${branch.isNewBranch ? '新分支首次推送可加 -u' : '推到已存在分支，必须是快进；非快进即停、绝不 -f'}）。用环境已配置的凭据，命令行不内联 token。\n` +
          `若被拒（凭据缺失/权限/非快进），pushRejected=true、pushPerformed=false，如实在 note 写原因与"如何用 ! git push 自行完成"的提示，不要 force、不要重写。成功则 pushPerformed=true。\n` +
          `回报 ok/pushPerformed/pushRejected/remoteRef(refs/heads/${branch.branchName})/pushUrlSafe(不含凭据的远程URL)/note。`,
          { schema: PUSH_SCHEMA, label: 'push', phase: 'Push', agentType: AT, effort: 'low', model: LIGHT_MODEL }, true)
        if (!pu.ok) { failedStages.push('Push'); push = { ok: false, pushPerformed: false, pushRejected: true, remoteRef: '', pushUrlSafe: remoteUrl, note: pu.error } }
        else push = pu.value
        note(`Push：${push.pushPerformed ? '已推送到 ' + push.remoteRef : '未推送（' + (push.pushRejected ? '被拒' : '失败') + '）：' + push.note}`)
        if (!push.pushPerformed) finalStatus = 'PUBLISH_BLOCKED'
      }

      // ---- RemoteVerify：独立只读核验（branchShaMatches 用 git ls-remote 取远程事实；committedFiles/禁入/工作树为发布副本本地核查；均不信执行者自报）----
      if (push.pushPerformed) {
        phase('RemoteVerify')
        const rv = await callAgent(
          `你是独立发布核验者，未参与前面的 clone/commit/push，只读核对客观事实、不改任何文件、不打分。${SAFETY}\n` +
          `针对发布副本 ${clone.repoDir}、远程 ${remoteUrl}、分支 ${branch.branchName}、本地提交 ${commit.commitSha}：\n` +
          `1) branchShaMatches：git ls-remote ${pushRemote} refs/heads/${branch.branchName} 的 SHA 是否 == ${commit.commitSha}。\n` +
          `2) committedFilesMatch：本次提交实际改动文件(git show --stat --name-only --pretty=format: ${commit.commitSha})是否与交付声明 ${JSON.stringify(pre.manifestFilesChanged)} 完全一致（多一个少一个都为 false）。remoteFiles 填实际提交文件。\n` +
          `3) noForbiddenFiles：提交内不含 .env/密钥/*.key/*.pem/凭据/.claude/settings.local.json/AGENTS.md 等禁入文件。\n` +
          `4) workTreeClean：发布副本本地 git status --porcelain 是否为空（本地工作树核查，非远程）。\n` +
          `回报 branchShaMatches/committedFilesMatch/noForbiddenFiles/workTreeClean/remoteSha/remoteFiles/note。`,
          { schema: REMOTEVERIFY_SCHEMA, label: 'remote-verify', phase: 'RemoteVerify', agentType: AT, effort: 'medium' }, true)
        if (!rv.ok) { failedStages.push('RemoteVerify'); note(`远程核验失败：${rv.error}`); remoteVerify = null }
        else remoteVerify = rv.value
        if (remoteVerify) note(`RemoteVerify：远程SHA一致=${remoteVerify.branchShaMatches}、提交文件一致=${remoteVerify.committedFilesMatch}、无禁入=${remoteVerify.noForbiddenFiles}、树干净=${remoteVerify.workTreeClean}。`)
      }
    }
  }

} catch (e) {
  if (e && e.__halt) { finalStatus = e.__halt.status; halted = true; note(`流程在 ${e.__halt.stage} 终止：${e.__halt.reason}。输出已有结果，不伪造后续。`) }
  else { throw e }
}

// ===================== 确定性发布终态（纯函数；priorStatus 短路保留前置 BLOCKED）=====================
const statusInput = {
  priorStatus: (finalStatus === 'PUBLISH_BLOCKED' || finalStatus === 'PUBLISH_NEEDS_CHOICE') ? finalStatus : null,
  highRiskBlocked: !!highRiskBlocked,
  deliverableStatus: pre ? pre.deliverableStatus : null,
  diffApplyCheckPassed: pre ? pre.diffApplyCheckPassed : false,
  branchAllowed: branchAllowed === null ? false : branchAllowed,
  dryRun,
  pushPerformed: !!(push && push.pushPerformed),
  remoteVerified: remoteVerify ? { branchShaMatches: remoteVerify.branchShaMatches, committedFilesMatch: remoteVerify.committedFilesMatch, noForbiddenFiles: remoteVerify.noForbiddenFiles, workTreeClean: remoteVerify.workTreeClean } : null,
  deliverableOpenItems: (pre && pre.openItems) || [],
}
const sr = computePublishStatus(statusInput)
finalStatus = sr.finalStatus
sr.reasons.forEach(note)

// ===================== Finalize（写 final-delivery.json + 报告）=====================
const finalDelivery = {
  schemaVersion: '1.0', workflow: 'publish-delivery', deliveryDir,
  finalStatus, dryRun,
  gitPolicy: { branchMode, branchPrefix, targetBranch, allowMainPush, pushRemote },
  branchChoice: branchChoiceProvided ? (branchMode === 'direct' ? 'current-branch-direct' : 'new-branch') : null,
  branchChoiceProvided,
  targetRepo: targetRepoArg || (pre && pre.targetRepo) || null,
  remoteUrl: remoteUrlArg || (pre && pre.remoteUrl) || null,
  deliverableStatus: pre ? pre.deliverableStatus : null,
  highRiskDomains: pre ? pre.highRiskDomains : [],
  highRiskBlocked: !!highRiskBlocked,
  branch: branch ? { name: branch.branchName, isNewBranch: branch.isNewBranch, createdFrom: branch.createdFrom, allowed: branchAllowed } : null,
  commit: commit ? { sha: commit.commitSha, author: commit.authorLine, files: commit.committedFiles } : null,
  push: push ? { performed: push.pushPerformed, rejected: push.pushRejected, remoteRef: push.remoteRef, url: push.pushUrlSafe } : null,
  remoteVerify: remoteVerify || null,
  filesChanged: pre ? pre.manifestFilesChanged : [],
  openItems: (pre && pre.openItems) || [],
  failedStages,
  rollback: branch && push && push.pushPerformed
    ? `如需回滚，请人工在终端亲自执行（会话内 git-guard 硬禁删远程分支，自动化无法代为执行；在 Claude Code 中可用 ! 前缀）：git push ${pushRemote} --delete ${branch.branchName}（删远程分支）。${branch.isNewBranch ? '' : '直推已存在分支的回滚需人工评估历史影响，勿用删分支方式。'}`
    : '未 push，无需远程回滚',
}

phase('Finalize')
if (clone && clone.publishDir) {
  const fn = await callAgent(
    `你负责把发布记录落盘（只在 ${clone.publishDir} 内写，绝不再动远程/原仓库）。${SAFETY}\n` +
    `1) 写 ${clone.publishDir}/final-delivery.json（规范 JSON，用下方对象原样写入；最终状态=${finalStatus}，不要更改）。\n` +
    `2) 写 ${clone.publishDir}/publish-report.md（中文）：含 1 最终状态(=${finalStatus}) 2 来源交付目录 3 【客户选择的发布方式 branchChoice=${branchChoiceProvided ? branchMode : '未选择'}（new-branch=新建分支 / direct=当前分支直接）】 4 远程与分支(含是否新分支/是否受保护) 5 提交(SHA/作者/文件) 6 push 结果 7 发布后远程核验四项(逐项) 8 开环项 9 回滚指引 10 若未发布/未核验，写明原因与"如何用 ! git push 自行完成"。\n` +
    `3) 写 ${clone.publishDir}/execution-log.md（用下方日志数组）。\n` +
    `回报 ok/absOutDir/written/note。\nfinal-delivery(JSON):\n${JSON.stringify(finalDelivery)}\nexecution-log(JSON):\n${JSON.stringify(execLog)}`,
    { schema: FINALIZE_SCHEMA, label: 'finalize', phase: 'Finalize', agentType: AT, effort: 'low', model: LIGHT_MODEL }, true)
  finalize = fn.ok ? fn.value : { ok: false, absOutDir: clone.publishDir, written: [], note: fn.error }
  note(`Finalize：${finalize.ok ? '已写入 ' + finalize.absOutDir + '（' + finalize.written.length + ' 文件）' : '失败：' + finalize.note}`)
} else {
  note('未建立发布副本（前置 BLOCKED/halt），仅返回结构化结果，无落盘目录。')
}

log(`publish-delivery 完成。最终状态=${finalStatus}；分支=${branch ? branch.branchName : 'N/A'}；push=${!!(push && push.pushPerformed)}；远程核验=${remoteVerify ? (remoteVerify.branchShaMatches && remoteVerify.committedFilesMatch && remoteVerify.noForbiddenFiles && remoteVerify.workTreeClean) : 'N/A'}；失败阶段 [${failedStages.join(', ') || '无'}]。`)

return { finalStatus, dryRun, publishDir: clone ? clone.publishDir : null, pre, branch, commit, push, remoteVerify, finalize, finalDelivery }
