// deliver-from-plan —— 方案 → 编码到测试全绿（桥接：plan-from-requirement 的产物 → 朱立明写码闭环）
//
// 定位：消费 plan-from-requirement 已落盘的方案目录，在【沙箱副本】里把代码写到测试全绿，产出 diff 交人工审。
//   绝不修改原仓库、绝不 commit/push/merge。设计真相源见 docs/12-plan-to-coding-bridge.md。
//   "写码闭环"的流程真相源是 vendor/zhuliming-templates/（已署名授权），本脚本只编排、不内联流程细节。
//
// 运行：
//   Workflow({ scriptPath: ".../.claude/workflows/deliver-from-plan.js", args: {
//     planDir: "<上游方案目录，必填，须 readinessForDev=ready>",
//     targetRepo: "<要落地的真实仓库；省略则取方案 manifest.target>",
//     outDir: "<落盘根目录>",                 // 缺省 "evidence/deliveries"
//     mode: "lite|standard|deep",            // 可省→按方案复杂度/风险自动选档（缩复审视角/effort/返工轮，验证锚点不缩）
//     vendorDir: "vendor/zhuliming-templates",
//     bridgeDoc: "docs/12-plan-to-coding-bridge.md",
//     maxImplRounds: 3, maxFixRounds: 2
//   }})
// 运行时事实：args 到脚本是 JSON 字符串需 parse；脚本体无文件系统访问，一切 IO 经子代理。

export const meta = {
  name: 'deliver-from-plan',
  description: '桥接：plan-from-requirement 的方案 → 在沙箱副本里把代码写到测试全绿 → 出 diff（不改原仓库/不提交）。就绪闸门→脚手架→测试物化(先红后绿)→编码→独立审查→修复→交付。流程真相源为 docs/12 与 vendor/zhuliming-templates。',
  whenToUse: '已有一份 readinessForDev=ready 的实现方案，想把它真正实现并跑到测试全绿、产出可审查的 diff，但不希望自动提交或改动原仓库时',
  phases: [
    { title: 'Preflight', detail: '读方案 manifest，确定性就绪闸门（ready 才放行）' },
    { title: 'Scaffold', detail: '复制 targetRepo 到沙箱；建 task 目录；据模板+方案生成 coding-workflow.md 与 todo' },
    { title: 'MaterializeTests', detail: '把 test-plan 物化成可运行 tests/+DONE；先红后绿核验 DONE 可信' },
    { title: 'Implement', detail: '沙箱内按方案写码到 DONE 全绿（只改 SCOPE 内文件，越界/红线即停）' },
    { title: 'Review', detail: '独立多视角并行审查（实现者不自评）；Fix 后由全新实例重新复审' },
    { title: 'Fix', detail: '仅当 needs-work：按意见改并重验 DONE 仍绿' },
    { title: 'Verify', detail: '独立子代理复跑 DONE + 核对 diff 仅动 SCOPE（不信实现者自报）' },
    { title: 'Deliver', detail: '出 diff/报告/manifest 落盘到带时间戳目录' },
  ],
}

// ===================== 参数（args 为 JSON 字符串，先 parse）=====================
const A = (() => {
  let a = args
  if (typeof a === 'string') { try { a = a.trim() ? JSON.parse(a) : {} } catch (e) { a = {} } }
  return (a && typeof a === 'object') ? a : {}
})()
const planDir = A.planDir ? String(A.planDir) : null
const targetRepoArg = A.targetRepo ? String(A.targetRepo) : null
const outDirBase = A.outDir ? String(A.outDir) : 'evidence/deliveries'
const vendorDir = A.vendorDir ? String(A.vendorDir) : 'vendor/zhuliming-templates'
const bridgeDoc = A.bridgeDoc ? String(A.bridgeDoc) : 'docs/12-plan-to-coding-bridge.md'
// 有界循环兜底轮数（防无限循环）：Implement 最多 MAX_IMPL 轮、Review↔Fix 最多 MAX_FIX 轮
const MAX_IMPL = (Number.isFinite(Number(A.maxImplRounds)) && Number(A.maxImplRounds) > 0) ? Number(A.maxImplRounds) : 3
const argMaxFix = (Number.isFinite(Number(A.maxFixRounds)) && Number(A.maxFixRounds) >= 0) ? Number(A.maxFixRounds) : null
// 分档（建议1·治"不成比例"）：按方案复杂度/风险自动选档（args.mode 可覆盖），只缩减"仪式"——复审视角数 / impl·review
// effort / 返工轮；验证锚点 MaterializeTests 与独立 Verify 恒 high、不随档位下调（缩仪式不缩安全）。
const userMode = ['lite', 'standard', 'deep'].includes(String(A.mode || '').toLowerCase()) ? String(A.mode).toLowerCase() : null
const MODE_CFG = {
  lite:     { lenses: ['correctness', 'scope-conformance'], implEffort: 'medium', reviewEffort: 'medium', maxFix: 1 },
  standard: { lenses: ['correctness', 'robustness', 'scope-conformance', 'risk-coverage'], implEffort: 'high', reviewEffort: 'high', maxFix: 2 },
  deep:     { lenses: ['correctness', 'robustness', 'scope-conformance', 'risk-coverage'], implEffort: 'high', reviewEffort: 'high', maxFix: 2 },
}
let mode = 'standard', CFG = MODE_CFG.standard, MAX_FIX = argMaxFix !== null ? argMaxFix : 2

const AT = 'general-purpose'   // 全工具内置 agentType（需 Read/Bash/Write/Edit），任意目录可跑

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

// >>> DELIVER-STATUS-START — 与 core/deliver-status.mjs 同一逻辑（行为由 scripts/self-check.mjs 比对锁定，单测见 scripts/deliver-status.test.mjs）；勿删本标记与 END 标记
// 确定性终态判定：BLOCKED 短路；唯有"全程干净 + diff 已落盘且 apply-check 通过且有变更文件"才给乐观态（#1/#2）
function computeDeliverStatus(input) {
  const i = input || {}
  const reasons = []
  if (i.priorStatus === 'BLOCKED') return { finalStatus: 'BLOCKED', reasons }

  const reviews = Array.isArray(i.reviews) ? i.reviews : []
  const verify = i.verify || null
  const verifiedGreen = !!(verify && verify.donePassedVerified === true && verify.scopeCleanVerified === true)
  const blockingReview = reviews.some(r => r && r.verdict === 'needs-work' && r.blocking)
  const redGreenUnconfirmed = !!(verify && verify.redGreenVerified === false)
  if (redGreenUnconfirmed) reasons.push('独立"先红后绿"未复现：DONE 可信度未被独立确认，降为带开环项交付。')

  const materializeOpenLoopItems = Array.isArray(i.materializeOpenLoopItems) ? i.materializeOpenLoopItems : []
  const gateOpenQuestions = Array.isArray(i.gateOpenQuestions) ? i.gateOpenQuestions : []
  const gateRemainingGaps = Array.isArray(i.gateRemainingGaps) ? i.gateRemainingGaps : []
  const hasOpenItems = materializeOpenLoopItems.length > 0 ||
    reviews.some(r => r && r.verdict === 'needs-work') ||
    redGreenUnconfirmed ||
    gateOpenQuestions.length > 0 || gateRemainingGaps.length > 0

  if (!i.implementPassed) { reasons.push('实现未达全绿，不交付。'); return { finalStatus: 'BLOCKED', reasons } }
  if (!verify) { reasons.push('缺独立验证（Verify 失败），不乐观交付。'); return { finalStatus: 'BLOCKED', reasons } }
  if (!verifiedGreen) { reasons.push('独立验证未确认 DONE 真绿 / 只动 SCOPE，不交付。'); return { finalStatus: 'BLOCKED', reasons } }
  if (i.reviewIncomplete) { reasons.push('独立复审视角不齐，不乐观交付。'); return { finalStatus: 'BLOCKED', reasons } }
  if (blockingReview) { reasons.push('存在阻断性审查意见未关闭。'); return { finalStatus: 'BLOCKED', reasons } }

  const diff = i.diff || null
  if (!diff || diff.ok !== true) { reasons.push('交付 diff 生成/落盘失败，状态降级 BLOCKED（不以 DELIVERED 收尾）。'); return { finalStatus: 'BLOCKED', reasons } }
  if (diff.diffApplyCheckPassed !== true) { reasons.push('diff 未通过 git apply --check，状态降级 BLOCKED。'); return { finalStatus: 'BLOCKED', reasons } }
  if (!Array.isArray(diff.filesChanged) || diff.filesChanged.length === 0) { reasons.push('交付未产出任何变更文件，状态降级 BLOCKED。'); return { finalStatus: 'BLOCKED', reasons } }

  return { finalStatus: hasOpenItems ? 'DELIVERED_WITH_OPEN_ITEMS' : 'DELIVERED', reasons }
}
// <<< DELIVER-STATUS-END

const SAFETY = `【硬安全约束】(1) 只在沙箱目录内写文件，绝不修改原仓库 ${targetRepoArg || '(方案目标仓库)'} 之外或之内的任何原始文件；(2) 绝不执行 git commit/push/merge/reset、绝不删库删表、绝不碰支付/权限/密钥/认证/不可逆操作——命中即停并在结构化结果里报告；(3) 只改方案 SCOPE(plan.affected.files)内的文件，越界即停。中文输出，只返回结构化结果。`

// ===================== Schemas =====================
const GATE_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  finalStatus: { type: 'string' }, readinessForDev: { type: 'string' },
  requirementGoal: { type: 'string' }, manifestTarget: { type: 'string' },
  affectedFiles: { type: 'array', items: { type: 'string' } },
  remainingGaps: { type: 'array', items: { type: 'string' } },
  openQuestions: { type: 'array', items: { type: 'string' } },
  complexity: { type: 'string', description: 'manifest.triage.complexity（simple/medium/complex），无则填 medium' },
  riskFlags: { type: 'array', items: { type: 'string' }, description: 'manifest.triage.riskFlags，无则 ["none"]' },
  targetReadable: { type: 'boolean' }, note: { type: 'string' },
}, required: ['finalStatus', 'readinessForDev', 'requirementGoal', 'manifestTarget', 'affectedFiles', 'remainingGaps', 'openQuestions', 'complexity', 'riskFlags', 'targetReadable', 'note'] }

const SCAFFOLD_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  ok: { type: 'boolean' }, runDir: { type: 'string' }, sandboxDir: { type: 'string' },
  taskDir: { type: 'string' }, codingWorkflowPath: { type: 'string' },
  scopeFiles: { type: 'array', items: { type: 'string' }, description: '相对仓库根的 SCOPE 文件路径' },
  optionalScopeFiles: { type: 'array', items: { type: 'string' } },
  todoUnits: { type: 'array', items: { type: 'string' } }, note: { type: 'string' },
}, required: ['ok', 'runDir', 'sandboxDir', 'taskDir', 'codingWorkflowPath', 'scopeFiles', 'optionalScopeFiles', 'todoUnits', 'note'] }

const MATERIALIZE_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  ok: { type: 'boolean' }, doneCommand: { type: 'string' }, testsDir: { type: 'string' },
  redCommand: { type: 'string', description: 'DONE 的 --red 模式：只跑【新功能测试】（未实现时应红）；供 Implement 自检与 Verify 独立复现' },
  regressionCommand: { type: 'string', description: 'DONE 的 --regression 模式：只跑【回归测试】（任何版本都应绿）' },
  newFeatureTestsFailOnCurrent: { type: 'boolean', description: '新功能测试在【未实现的当前沙箱】上是否如预期 FAIL（红）' },
  regressionTestsPassOnCurrent: { type: 'boolean', description: '回归/既有行为测试在当前沙箱上是否如预期 PASS（绿）' },
  redExitCode: { type: 'number' }, autoVerifiableCount: { type: 'number' },
  openLoopItems: { type: 'array', items: { type: 'string' }, description: '无法自动验、转人工核对的项（如无 pwsh 的 .ps1）' },
  note: { type: 'string' },
}, required: ['ok', 'doneCommand', 'redCommand', 'regressionCommand', 'testsDir', 'newFeatureTestsFailOnCurrent', 'regressionTestsPassOnCurrent', 'redExitCode', 'autoVerifiableCount', 'openLoopItems', 'note'] }

const IMPLEMENT_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  passed: { type: 'boolean', description: 'DONE 命令是否全绿' }, doneExitCode: { type: 'number' },
  filesChanged: { type: 'array', items: { type: 'string' } },
  scopeViolations: { type: 'array', items: { type: 'string' }, description: '改到 SCOPE 外文件的清单（应为空）' },
  redLineHit: { type: 'boolean' }, redLineReason: { type: 'string' },
  summary: { type: 'string' }, progressNote: { type: 'string' },
}, required: ['passed', 'doneExitCode', 'filesChanged', 'scopeViolations', 'redLineHit', 'redLineReason', 'summary', 'progressNote'] }

const REVIEW_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  lens: { type: 'string' }, verdict: { type: 'string', enum: ['ok', 'needs-work'] },
  findings: { type: 'array', items: { type: 'string' } },
  blocking: { type: 'boolean', description: '是否阻断性（correctness/scope 越界等）' }, note: { type: 'string' },
}, required: ['lens', 'verdict', 'findings', 'blocking', 'note'] }

const FIX_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  passed: { type: 'boolean', description: '修复后 needs-work 是否清零' }, donePassed: { type: 'boolean', description: '修复后 DONE 是否仍全绿' },
  addressed: { type: 'array', items: { type: 'string' } }, stillOpen: { type: 'array', items: { type: 'string' } },
  filesChanged: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' },
}, required: ['passed', 'donePassed', 'addressed', 'stillOpen', 'filesChanged', 'summary'] }

const VERIFY_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  donePassedVerified: { type: 'boolean', description: '独立复跑最终 DONE 是否真绿（ALL PASSED / exit 0）' },
  doneExitCodeVerified: { type: 'number' },
  redGreenVerified: { type: 'boolean', description: '在未实现版上独立复现"新功能红 + 回归绿"' },
  changedFilesVerified: { type: 'array', items: { type: 'string' }, description: '实测变更的文件' },
  scopeCleanVerified: { type: 'boolean', description: '实测变更是否只落在 SCOPE 内' },
  note: { type: 'string' },
}, required: ['donePassedVerified', 'doneExitCodeVerified', 'redGreenVerified', 'changedFilesVerified', 'scopeCleanVerified', 'note'] }

const DIFF_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  ok: { type: 'boolean', description: '是否成功生成可用 diff（无任何变更文件时为 false）' },
  diffStat: { type: 'string' }, filesChanged: { type: 'array', items: { type: 'string' }, description: 'target-root-relative 路径' },
  diffApplyCheckPassed: { type: 'boolean' }, note: { type: 'string' },
}, required: ['ok', 'diffStat', 'filesChanged', 'diffApplyCheckPassed', 'note'] }
const DELIVER_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  ok: { type: 'boolean' }, absOutDir: { type: 'string' }, written: { type: 'array', items: { type: 'string' } }, note: { type: 'string' },
}, required: ['ok', 'absOutDir', 'written', 'note'] }

// ===================== 状态收集 =====================
let finalStatus = 'FAILED'
let gate = null, scaffold = null, materialize = null, implement = null, reviews = [], fix = null, verify = null, deliver = null
let trustworthy = false, reviewIncomplete = false, halted = false, diffResult = null
const failedStages = [], fixHistory = []

try {
  if (!planDir) halt('Preflight', 'args.planDir 缺失（必填）')

  // ---- Preflight：读 manifest + 确定性就绪闸门 ----
  phase('Preflight')
  const pf = await callAgent(
    `你是只读分析者。读取方案目录 ${planDir} 下的 run-manifest.json（必要时再看 requirement.json / plan.json）。${SAFETY}\n` +
    `回报：finalStatus、readinessForDev、requirementGoal(需求一句话目标)、manifestTarget(manifest.target 即被分析的目标仓库绝对路径)、affectedFiles(plan.affected.files，原样)、remainingGaps、openQuestions、complexity(manifest.triage.complexity，无则 medium)、riskFlags(manifest.triage.riskFlags，无则 ["none"])、targetReadable(用 Bash 确认 ${targetRepoArg || 'manifestTarget'} 存在且可读)。不要改任何文件。`,
    { schema: GATE_SCHEMA, label: 'preflight-gate', phase: 'Preflight', agentType: AT, effort: 'low' }, true)
  if (!pf.ok) { failedStages.push('Preflight'); halt('Preflight', pf.error) }
  gate = pf.value
  const targetRepo = targetRepoArg || gate.manifestTarget
  const gateOk = ['PASS', 'PARTIAL'].includes(gate.finalStatus) && gate.readinessForDev === 'ready'
  note(`就绪闸门：finalStatus=${gate.finalStatus}，readinessForDev=${gate.readinessForDev} → ${gateOk ? '放行' : '拦截'}；目标仓库=${targetRepo}（可读=${gate.targetReadable}）`)
  if (!gateOk) { finalStatus = 'BLOCKED'; note('方案未就绪（需 PASS/PARTIAL 且 readinessForDev=ready），不进入编码。请回到需求澄清或方案返工。') }
  else if (!gate.targetReadable) { finalStatus = 'BLOCKED'; note('目标仓库不可读，无法建立沙箱。') }
  else {

    // ---- 分档（建议1）：按方案复杂度/风险自动选档，args.mode 可覆盖；高风险至少 standard ----
    const cplx = String(gate.complexity || 'medium')
    const hasRisk = (gate.riskFlags || []).some(f => f && f !== 'none')
    mode = userMode || (cplx === 'simple' && !hasRisk ? 'lite' : cplx === 'complex' ? 'deep' : 'standard')
    CFG = MODE_CFG[mode]; MAX_FIX = argMaxFix !== null ? argMaxFix : CFG.maxFix
    note(`分档：复杂度=${cplx}${hasRisk ? '+高风险(' + (gate.riskFlags || []).join('/') + ')' : ''} → mode=${mode}（${userMode ? '用户指定' : '自动'}）：复审视角 ${CFG.lenses.length}、impl/review effort=${CFG.implEffort}/${CFG.reviewEffort}、返工上限 ${MAX_FIX}（命门 MaterializeTests/Verify 恒 high 不降）。`)

    // ---- Scaffold：复制沙箱 + 建 task 目录 + 生成 coding-workflow.md ----
    phase('Scaffold')
    const sc = await callAgent(
      `你负责脚手架搭建。${SAFETY}\n` +
      `步骤(全部用 Bash/Write，绝不碰原仓库)：\n` +
      `1) ts=$(date +%Y%m%d-%H%M%S)；runDir="${outDirBase}/$ts"（相对你的 cwd）；mkdir -p "$runDir"；用 realpath 取绝对路径。\n` +
      `2) 沙箱：把目标仓库复制进沙箱。优先使用 rsync -a --delete --exclude .git --exclude node_modules --exclude dist --exclude build --exclude .next --exclude coverage --exclude .env --exclude ".env.*" --exclude "*.pem" --exclude "*.key" --exclude "id_rsa*" --exclude "*.p12" --exclude "*.pfx" "${targetRepo}/" "$runDir/sandbox/"；无 rsync 时才用 mkdir -p "$runDir/sandbox" && cp -a "${targetRepo}/." "$runDir/sandbox/"。复制后立即清除沙箱内版本历史、构建产物与敏感物：rm -rf 沙箱内的 .git/node_modules/dist/build/.next/coverage，并用 find 删除 .env/.env.*/*.pem/*.key/id_rsa*/*.p12/*.pfx/.npmrc/.pypirc/*credentials*.json/*secret*.json/*.bak/*.dump/*.sql.gz/*.log。不要跟随符号链接到沙箱外；发现指向沙箱外的 symlink 要删除或停下报告。校验沙箱关键文件仍在、且 .git/.env/密钥/日志不在。\n` +
      `3) task 目录：mkdir -p "$runDir/task-workflow/"{input,output,tests,state}；mkdir -p "$runDir/task-workflow/state/scratch"。\n` +
      `4) 把方案产物（final-plan.md 若有、plan.json、test-plan.json、requirement.json、risks.json）从 ${planDir} 复制到 "$runDir/task-workflow/input/"。\n` +
      `5) 读 vendored 模板 ${vendorDir}/build-workflow.md，按其结构生成一份**填好的** "$runDir/task-workflow/coding-workflow.md"：\n` +
      `   - §1 GOAL=需求目标；§2 VARIABLES：INPUT=task-workflow/input/、OUTPUT=沙箱内被改文件、DONE=见 MaterializeTests 产出的命令（先写占位"见 tests/，由桥接物化；入口支持 --red/--regression 按类筛选与可选目标目录"）、SCOPE=【只许改下列文件】、CONTRACT=保持 .sh/.ps1 行为一致与既有退出码语义；\n` +
      `   - §3 在通用红线外，追加本任务红线（来自 risks.json 高危项）；§4 LOOP 的 todo 用 plan.json.steps；\n` +
      `   - §7.1 复核视角写明四个：correctness / robustness / scope-conformance / risk-coverage（见 ${bridgeDoc} §5.5）。\n` +
      `6) SCOPE 规整：把 plan.affected.files 与 plan.modify[].path/plan.add[].path 统一规整成【相对仓库根】的路径；拒绝绝对路径、../ 目录穿越、指向沙箱外的符号链接；去掉 ${targetRepo} 前缀；把带"(可选)/optional"标记的归入 optionalScopeFiles。\n` +
      `7) 生成 "$runDir/task-workflow/state/todo.md"（每条 step 一行未勾选）与空的 progress.md。\n` +
      `回报 ok/runDir(绝对)/sandboxDir/taskDir/codingWorkflowPath/scopeFiles(相对仓库根)/optionalScopeFiles/todoUnits/note。`,
      { schema: SCAFFOLD_SCHEMA, label: 'scaffold', phase: 'Scaffold', agentType: AT, effort: 'medium' }, true)
    if (!sc.ok) { failedStages.push('Scaffold'); halt('Scaffold', sc.error) }
    scaffold = sc.value
    if (!scaffold.ok || !scaffold.sandboxDir) halt('Scaffold', 'scaffold 未成功建立沙箱/目录：' + scaffold.note)
    note(`Scaffold：runDir=${scaffold.runDir}；SCOPE(${scaffold.scopeFiles.length})=${scaffold.scopeFiles.join(', ')}${scaffold.optionalScopeFiles.length ? '；可选=' + scaffold.optionalScopeFiles.join(', ') : ''}；todo ${scaffold.todoUnits.length} 项。`)
    const runDir = scaffold.runDir, sandboxDir = scaffold.sandboxDir, taskDir = scaffold.taskDir

    // ---- MaterializeTests：物化可运行 tests/ + DONE，并"先红后绿"核验可信 ----
    phase('MaterializeTests')
    const mt = await callAgent(
      `你负责把测试规格物化成【可运行的测试】并核验其可信。${SAFETY}\n` +
      `输入：方案的 test-plan.json（在 ${taskDir}/input/）。沙箱：${sandboxDir}（当前为【未实现新功能】的原始代码副本）。\n` +
      `步骤：\n` +
      `1) 把 test-plan.json 的用例物化到 ${taskDir}/tests/，并写一个 DONE 入口（如 ${taskDir}/tests/run_verify.sh）：默认（无参数）跑全部测试，全过则 echo "ALL PASSED" 并 exit 0，否则非0退出。测试要对【沙箱里的脚本】跑（用绝对/相对沙箱路径）。\n` +
      `2) 把测试分两类，并让 DONE 入口支持【按类筛选 + 指定目标】（硬契约：Verify 要靠它在原仓库新副本上独立复现"红/绿"）：①【新功能测试】针对本次要实现的行为（未实现时应红）；②【回归测试】针对既有且不该被破坏的行为（如既有退出码语义，应一直绿）。DONE 入口必须支持开关 \`--red\`（只跑①）与 \`--regression\`（只跑②），并接受一个可选的【目标目录】参数（默认沙箱 ${sandboxDir}），使同一套测试能对任意代码副本运行。\n` +
      `3) verificationType 无法自动验的（如本机无 pwsh 的 .ps1 行为：先 command -v pwsh 探测）→ 不要硬塞进 DONE，列入 openLoopItems 作人工核对，并在 note 说明。\n` +
      `4) **先红后绿核验**（关键）：在当前未实现的沙箱上，用 --red 跑①确认其为红、用 --regression 跑②确认其为绿；报告 newFeatureTestsFailOnCurrent、regressionTestsPassOnCurrent、redExitCode(①的退出码)。\n` +
      `回报 ok/doneCommand(默认跑全部)/redCommand(只跑新功能,--red 的完整命令)/regressionCommand(只跑回归,--regression 的完整命令)/testsDir/newFeatureTestsFailOnCurrent/regressionTestsPassOnCurrent/redExitCode/autoVerifiableCount/openLoopItems/note。`,
      { schema: MATERIALIZE_SCHEMA, label: 'materialize-tests', phase: 'MaterializeTests', agentType: AT, effort: 'high' }, true)
    if (!mt.ok) { failedStages.push('MaterializeTests'); halt('MaterializeTests', mt.error) }
    materialize = mt.value
    // 确定性可信判定（不只信 agent 自述）：新功能红 且 回归绿
    trustworthy = materialize.newFeatureTestsFailOnCurrent === true && materialize.regressionTestsPassOnCurrent === true
    note(`测试物化：DONE=\`${materialize.doneCommand}\`；先红后绿核验：新功能红=${materialize.newFeatureTestsFailOnCurrent} / 回归绿=${materialize.regressionTestsPassOnCurrent} → DONE可信=${trustworthy}；自动用例 ${materialize.autoVerifiableCount}，开环人工项 ${materialize.openLoopItems.length}。`)
    if (materialize.openLoopItems.length) note(`开环人工核对项（未自动覆盖）：${materialize.openLoopItems.join(' | ')}`)
    if (!trustworthy) { finalStatus = 'BLOCKED'; note('DONE 未通过"先红后绿"可信核验（新功能未红或回归未绿），不蒙着写码。已落保留沙箱/测试供人工接手。') }
    else {

      // ---- Implement：沙箱内写码到 DONE 全绿（有界循环，重试续上一轮）----
      phase('Implement')
      const scopeList = scaffold.scopeFiles.join(', ')
      let implRound = 0
      while (implRound < MAX_IMPL) {
        implRound++
        const resume = implRound === 1 ? '' : `⚠️ 第 ${implRound - 1} 轮 DONE 未全绿：先读 ${taskDir}/state/progress.md 与现有沙箱改动，【续上一轮】继续修，不要从零重写。\n`
        const im = await callAgent(
          `你是实现工程师，在【沙箱】${sandboxDir} 里写代码。${SAFETY}\n${resume}` +
          `真相源：读 ${scaffold.codingWorkflowPath} 的 §1–§8 严格执行（流程细节以它为准，本提示不重复）。方案在 ${taskDir}/input/（plan.json 的 modify/add/steps/reuse 是落点）。\n` +
          `【SCOPE：只许改这些沙箱内文件】${scopeList}（相对仓库根；对应沙箱路径=${sandboxDir}/<相对路径>）。改到 SCOPE 外即属越界，必须停。\n` +
          `循环：取下一个未完成 step → 在 state/scratch 想清楚 → 改沙箱内 SCOPE 文件 → 跑 DONE：\`${materialize.doneCommand}\` → 把这一轮写进 ${taskDir}/state/progress.md（追加，不删）。直到 DONE 全绿(exit 0/ALL PASSED)。\n` +
          `回报 passed(DONE是否全绿)/doneExitCode/filesChanged(沙箱内改了哪些，相对仓库根)/scopeViolations(改到SCOPE外的，应空)/redLineHit/redLineReason/summary/progressNote。`,
          { schema: IMPLEMENT_SCHEMA, label: `implement#${implRound}`, phase: 'Implement', agentType: AT, effort: CFG.implEffort }, true)
        if (!im.ok) { failedStages.push(`Implement#${implRound}`); halt('Implement', im.error) }
        implement = im.value
        if (implement.redLineHit) { finalStatus = 'BLOCKED'; note(`⛔ 触及红线，停止：${implement.redLineReason}`); break }
        if ((implement.scopeViolations || []).length) { finalStatus = 'BLOCKED'; note(`⛔ SCOPE 越界，停止：${implement.scopeViolations.join(', ')}`); break }
        note(`Implement r${implRound}：DONE ${implement.passed ? '全绿✅' : '未绿(exit ' + implement.doneExitCode + ')'}；改动 ${implement.filesChanged.join(', ') || '无'}。`)
        if (implement.passed) break
        if (implRound >= MAX_IMPL) note(`已达实现轮次上限 ${MAX_IMPL}，DONE 仍未全绿。`)
      }

      if (implement && implement.passed && finalStatus !== 'BLOCKED') {
        // ---- Review ↔ Fix 有界循环：实现者不自评；每次 Fix 后必由【全新独立实例】重新复审（C5）----
        const LENSES_ALL = [
          { lens: 'correctness', focus: '对照 plan 与验收标准，改动是否真满足需求、边界是否出错' },
          { lens: 'robustness', focus: '异常/边界/坏输入是否会崩溃、卡死或被吞' },
          { lens: 'scope-conformance', focus: '是否只改了 plan.affected.files、是否符合 plan.modify 的 why、有无夹带无关改动' },
          { lens: 'risk-coverage', focus: 'risks.json 高危项是否被测试真覆盖、既有退出码等语义是否被破坏' },
        ]
        const LENSES = LENSES_ALL.filter(L => CFG.lenses.includes(L.lens))   // 按档位裁剪复审视角（lite 仅 correctness+scope-conformance）
        async function doReview(round) {
          const rv = await parallel(LENSES.map(L => () =>
            callAgent(
              `你是独立审查者（视角=${L.lens}，第 ${round} 轮），未参与实现/修复，只读不许改。${SAFETY}\n` +
              `按 ${scaffold.codingWorkflowPath} 的 §7.1 与 ${bridgeDoc} §5.5 的「${L.lens}」视角，审查沙箱 ${sandboxDir} 的当前改动（对照 ${taskDir}/input/ 的方案）。聚焦：${L.focus}。\n` +
              `可只读跑 DONE（\`${materialize.doneCommand}\`）佐证。给 findings + verdict(ok/needs-work) + blocking(是否阻断性) + note。`,
              { schema: REVIEW_SCHEMA, label: `review-r${round}:${L.lens}`, phase: 'Review', agentType: AT, effort: CFG.reviewEffort }, true)
              .then(r => r.ok ? r.value : null)
          ))
          return rv.filter(Boolean)
        }

        phase('Review')
        reviews = await doReview(0)
        note(`Review r0：${reviews.length}/${LENSES.length} 视角，needs-work ${reviews.filter(r => r.verdict === 'needs-work').length}。`)
        let fixRound = 0
        while (reviews.filter(r => r.verdict === 'needs-work').length && fixRound < MAX_FIX) {
          fixRound++
          const needWork = reviews.filter(r => r.verdict === 'needs-work')
          const findings = needWork.flatMap(r => r.findings.map(f => `[${r.lens}] ${f}`))
          phase('Fix')   // C6：Fix 是独立阶段，显式起 phase 并记 fixHistory
          const fx = await callAgent(
            `你是修复工程师，在沙箱 ${sandboxDir} 里改（第 ${fixRound} 轮）。${SAFETY}\n` +
            `按 ${scaffold.codingWorkflowPath} 的 §7.2 修复协议处理以下审查意见，只改 SCOPE 内文件：\n${findings.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n` +
            `改完【必须重跑 DONE 仍全绿】(\`${materialize.doneCommand}\`)——修复不得破坏已通过部分。把改动记进 ${taskDir}/state/progress.md。\n` +
            `回报 passed/donePassed(DONE是否仍绿)/addressed/stillOpen/filesChanged/summary。`,
            { schema: FIX_SCHEMA, label: `fix#${fixRound}`, phase: 'Fix', agentType: AT, effort: CFG.implEffort }, false)
          if (!fx.ok) { failedStages.push(`Fix#${fixRound}`); note(`Fix r${fixRound} 失败：${fx.error}`); break }
          fix = fx.value
          fixHistory.push({ round: fixRound, addressed: fix.addressed, stillOpen: fix.stillOpen, donePassed: fix.donePassed })
          note(`Fix r${fixRound}：处理 ${fix.addressed.length}，仍开放 ${fix.stillOpen.length}，DONE仍绿=${fix.donePassed}。`)
          if (!fix.donePassed) { note('修复破坏了 DONE，停止并交人工。'); break }
          // 关键（C5）：Fix 后绝不由修复者自评，必由全新独立实例重新复审
          phase('Review')
          reviews = await doReview(fixRound)
          note(`复审 r${fixRound}：${reviews.length}/${LENSES.length} 视角，needs-work ${reviews.filter(r => r.verdict === 'needs-work').length}。`)
        }
        // C17：复审完整性闸门——任一轮复审视角不齐（子代理失败致 reviews 残缺）即按"独立复审缺失"处理，不得乐观交付
        if (reviews.length < LENSES.length) { reviewIncomplete = true; note(`⚠ 独立复审不完整：仅 ${reviews.length}/${LENSES.length} 视角返回，按缺失独立复审处理。`) }

        // ---- 独立 Verify（C4）：全新只读实例亲手复跑 DONE + 独立核对 diff 仅动 SCOPE，不信实现/修复者自报 ----
        phase('Verify')
        const vf = await callAgent(
          `你是独立验证者，未参与实现/修复/审查，只复核客观事实、不打分、不改任何文件。${SAFETY}\n` +
          `1) 亲手复跑最终 DONE：\`${materialize.doneCommand}\`，取真实退出码与是否输出 "ALL PASSED"。\n` +
          `2) 先红后绿独立复核：把原仓库 ${targetRepo} 复制到一个 mktemp -d 临时副本（不含本次实现），用 DONE 的 --red 对该副本跑（命令形如 \`${materialize ? materialize.redCommand : '<redCommand>'}\`，把目标目录指向该副本），确认新功能测试在【未实现版】上确为红（非0）；再用 --regression（形如 \`${materialize ? materialize.regressionCommand : '<regressionCommand>'}\`）确认回归为绿（0）。两者都成立才置 redGreenVerified=true。\n` +
          `3) 独立算 diff：diff -ruN "${targetRepo}" "${sandboxDir}"（忽略 .git），列出真正变更的文件，判断是否【只动了 SCOPE】=${JSON.stringify(scaffold.scopeFiles)}（可选 ${JSON.stringify(scaffold.optionalScopeFiles)}）。\n` +
          `回报 donePassedVerified(最终DONE是否真绿)/doneExitCodeVerified/redGreenVerified(先红后绿是否独立复现)/changedFilesVerified(实测变更文件)/scopeCleanVerified(是否只动SCOPE)/note。`,
          { schema: VERIFY_SCHEMA, label: 'independent-verify', phase: 'Verify', agentType: AT, effort: 'high' }, true)
        if (!vf.ok) { failedStages.push('Verify'); note(`独立验证失败：${vf.error}`) }
        verify = vf.ok ? vf.value : null
        if (verify) note(`独立验证：DONE真绿=${verify.donePassedVerified}(exit ${verify.doneExitCodeVerified})、先红后绿复现=${verify.redGreenVerified}、只动SCOPE=${verify.scopeCleanVerified}。`)
      }
    }
  }

  // 终态延后到 Deliver 阶段用 computeDeliverStatus 计算：diff 落盘 + apply-check 也是判定输入（#1/#2）。

} catch (e) {
  if (e && e.__halt) { finalStatus = e.__halt.status; halted = true; note(`流程在 ${e.__halt.stage} 终止：${e.__halt.reason}。输出已有结果，不伪造后续。`) }
  else { throw e }
}

// ===================== Deliver（先生成 diff + apply-check，据此定终态，再落盘）=====================
phase('Deliver')
// step 1：独立生成 target-root-relative diff 并做 git apply --check —— 这是终态判定的最后一项事实
if (scaffold && scaffold.runDir && finalStatus !== 'BLOCKED' && !halted) {
  const gd = await callAgent(
    `你负责生成交付 diff（只在 ${scaffold.runDir} 内写，绝不动原仓库、绝不 commit/push）。${SAFETY}\n` +
    `1) 生成 target-root-relative diff：以 ${targetRepoArg || (gate && gate.manifestTarget)} 为 target root，仅基于独立验证得到的 changedFiles/scopeFiles 收集相对路径；为每个相对路径从原仓库和沙箱复制到临时 diff-root/old/<rel> 与 diff-root/new/<rel>，然后在 diff-root 内执行 git diff --no-index --src-prefix=a/ --dst-prefix=b/ old new > "${scaffold.runDir}/changes.diff"（退出码 1=有差异属正常），再把 diff 头中的 a/old/、b/new/ 规范化为 a/、b/。禁止 diff 头出现绝对路径、sandbox、targetRepo、old/ 或 new/ 前缀；filesChanged 必须全部是 target-root-relative 路径。\n` +
    `2) 检查 diff 可应用：复制一份干净 target root 到临时 apply-check 目录，在该目录执行 git apply --check "${scaffold.runDir}/changes.diff"；通过则 diffApplyCheckPassed=true，否则 false。若 diff 为空（无任何变更文件）则 ok=false。\n` +
    `只产出 changes.diff 并回报事实，不要写 manifest 或报告。回报 ok/diffStat/filesChanged(target-root-relative)/diffApplyCheckPassed/note。`,
    { schema: DIFF_SCHEMA, label: 'generate-diff', phase: 'Deliver', agentType: AT, effort: 'medium' }, true)
  diffResult = gd.ok ? gd.value : { ok: false, diffStat: '', filesChanged: [], diffApplyCheckPassed: false, note: gd.error }
  note(`Diff：${diffResult.ok ? '已生成 changes.diff（' + diffResult.diffStat + '），apply-check=' + diffResult.diffApplyCheckPassed : '失败：' + diffResult.note}`)
} else if (scaffold && scaffold.runDir) {
  note('前置已 BLOCKED/halt，跳过 diff 生成（无可交付实现）。')
} else {
  note('未建立 runDir（就绪闸门或前置失败），无 diff 可生成。')
}

// step 2：确定性终态（纯函数；非 halt 路径才重算；diff 也是判定输入 —— #1/#2 不再以 DELIVERED 收尾失败交付）
if (!halted) {
  const sr = computeDeliverStatus({
    priorStatus: finalStatus,
    implementPassed: !!(implement && implement.passed),
    verify: verify ? { donePassedVerified: verify.donePassedVerified, scopeCleanVerified: verify.scopeCleanVerified, redGreenVerified: verify.redGreenVerified } : null,
    reviews: reviews.map(r => ({ verdict: r.verdict, blocking: r.blocking })),
    reviewIncomplete,
    materializeOpenLoopItems: materialize ? materialize.openLoopItems : [],
    gateOpenQuestions: (gate && gate.openQuestions) || [],
    gateRemainingGaps: (gate && gate.remainingGaps) || [],
    diff: (scaffold && scaffold.runDir) ? diffResult : null,
  })
  finalStatus = sr.finalStatus
  sr.reasons.forEach(note)
}

// step 3：据最终事实构建 manifest（filesChanged 以独立验证为准 —— #3；记录 diff apply-check 结果）
const verifiedChanged = (verify && Array.isArray(verify.changedFilesVerified) && verify.changedFilesVerified.length) ? verify.changedFilesVerified : null
const deliverManifest = {
  schemaVersion: '1.0',
  workflow: 'deliver-from-plan', planDir, targetRepo: targetRepoArg || (gate && gate.manifestTarget) || null,
  finalStatus, mode, modeLenses: CFG.lenses,
  gate: gate ? { finalStatus: gate.finalStatus, readinessForDev: gate.readinessForDev, requirementGoal: gate.requirementGoal } : null,
  scope: scaffold ? { scopeFiles: scaffold.scopeFiles, optionalScopeFiles: scaffold.optionalScopeFiles } : null,
  doneCommand: materialize ? materialize.doneCommand : null,
  doneTrustworthy: trustworthy,
  doneTrustEvidence: materialize ? { redCommand: materialize.redCommand, regressionCommand: materialize.regressionCommand, newFeatureTestsFailOnCurrent: materialize.newFeatureTestsFailOnCurrent, regressionTestsPassOnCurrent: materialize.regressionTestsPassOnCurrent, redExitCode: materialize.redExitCode } : null,
  implementPassed: !!(implement && implement.passed),
  filesChanged: verifiedChanged || (diffResult ? diffResult.filesChanged : []) || (implement ? implement.filesChanged : []),
  filesChangedSource: verifiedChanged ? 'independent-verify' : ((diffResult && diffResult.filesChanged.length) ? 'diff' : 'implementer-self-report'),
  scopeViolations: implement ? implement.scopeViolations : [],
  redLine: implement && implement.redLineHit ? implement.redLineReason : null,
  diffApplyCheckPassed: diffResult ? diffResult.diffApplyCheckPassed : null,
  diffStat: diffResult ? diffResult.diffStat : null,
  reviewVerdicts: reviews.map(r => ({ lens: r.lens, verdict: r.verdict, blocking: r.blocking })),
  fix: fix ? { passed: fix.passed, donePassed: fix.donePassed, stillOpen: fix.stillOpen } : null,
  fixHistory,
  reviewComplete: !reviewIncomplete,
  independentVerify: verify ? { donePassedVerified: verify.donePassedVerified, doneExitCodeVerified: verify.doneExitCodeVerified, redGreenVerified: verify.redGreenVerified, scopeCleanVerified: verify.scopeCleanVerified } : null,
  openItems: [
    ...(materialize ? materialize.openLoopItems : []),
    ...((gate && gate.openQuestions) || []).map(q => `方案待确认: ${q}`),
    ...((gate && gate.remainingGaps) || []).map(g => `方案遗留: ${g}`),
    ...reviews.filter(r => r.verdict === 'needs-work' && !(fix && fix.passed)).flatMap(r => r.findings.map(f => `审查未关闭[${r.lens}]: ${f}`)),
    ...(verify && verify.redGreenVerified === false ? ['独立"先红后绿"未复现：DONE 可信度未独立确认'] : []),
    ...(diffResult && diffResult.diffApplyCheckPassed === false ? ['diff 未通过 git apply --check'] : []),
  ],
  failedStages,
}

// step 4：落盘（diff 已生成；本步只写 manifest/报告/日志，不重新生成 diff）
if (scaffold && scaffold.runDir) {
  const dl = await callAgent(
    `你负责把交付产物落盘（只在 ${scaffold.runDir} 内写，绝不动原仓库、绝不 commit/push）。${SAFETY}\n` +
    `changes.diff 已由上一步生成（git apply --check=${diffResult ? diffResult.diffApplyCheckPassed : 'N/A'}），不要重新生成或修改它。最终状态已确定为 ${finalStatus}，原样写入、不要更改。\n` +
    `步骤：\n` +
    `1) 写 ${scaffold.runDir}/delivery-manifest.json（规范 JSON，用下方对象原样写入）。\n` +
    `2) 写 ${scaffold.runDir}/delivery-report.md（中文）：含 1 最终状态(=${finalStatus}) 2 来源方案 3 就绪闸门结果 4 DONE 命令与"先红后绿"可信证据 5 变更文件(filesChanged，来源=${deliverManifest.filesChangedSource})与 SCOPE 合规 6 diff apply check 结果(=${diffResult ? diffResult.diffApplyCheckPassed : 'N/A'}；未通过须写明这就是未给 DELIVERED 的原因) 7 各视角审查结论 8 修复 9 开环人工核对项(逐条) 10 红线/越界停点(若有) 11 如何应用 diff(人工 patch 步骤) + 明确"桥接未 commit/merge"。\n` +
    `3) 写 ${scaffold.runDir}/execution-log.md（用下方日志数组）。\n` +
    `4) 写 ${scaffold.runDir}/residual-verification.md：把 manifest.openItems 每个开环/未验证项整理成"换到具备相应环境的机器上照着做即可闭环"的【可执行清单】（无 pwsh 的 .ps1 → 给装 pwsh 后的命令/对拍；需特定运行时的用例 → 给环境与命令；待拍板歧义 → 列成待确认问题）。\n` +
    `回报 ok/absOutDir/written(文件名列表)/note。\n` +
    `delivery-manifest(JSON):\n${JSON.stringify(deliverManifest)}\nexecution-log(JSON):\n${JSON.stringify(execLog)}`,
    { schema: DELIVER_SCHEMA, label: 'deliver-persist', phase: 'Deliver', agentType: AT, effort: 'medium' }, true)
  deliver = dl.ok
    ? { ...dl.value, diffStat: diffResult ? diffResult.diffStat : '', filesChanged: deliverManifest.filesChanged, diffApplyCheckPassed: diffResult ? diffResult.diffApplyCheckPassed : false }
    : { ok: false, absOutDir: scaffold.runDir, written: [], note: dl.error, diffStat: '', filesChanged: [], diffApplyCheckPassed: false }
  note(`Deliver 落盘：${deliver.ok ? '已写入 ' + deliver.absOutDir + '（' + deliver.written.length + ' 文件）' : '失败：' + deliver.note}`)
} else {
  note('未建立 runDir（就绪闸门或前置失败），无产物可落盘。')
}

log(`deliver-from-plan 完成。最终状态=${finalStatus}；DONE可信=${trustworthy}；实现全绿=${!!(implement && implement.passed)}；审查 ${reviews.length} 视角；开环遗留 ${deliverManifest.openItems.length} 项；失败阶段 [${failedStages.join(', ') || '无'}]。`)

return { finalStatus, runDir: scaffold ? scaffold.runDir : null, gate, scaffold, materialize, trustworthy, implement, reviews, fix, deliver, manifest: deliverManifest }
