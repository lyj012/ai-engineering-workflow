// auto-deliver —— 端到端编排器：一句需求 → 方案 → 编码到测试全绿 → 自动发布（不建 PR）
//
// 定位：用「目标仓库 + 一段需求描述」一键跑完 需求理解→现有代码分析→方案→测试方案→测试代码→业务代码→
//   独立评审→自动修复→独立验证→建分支→commit→push→返回最终交付。用【一层 workflow()】串三个已存在引擎
//   （plan-from-requirement / deliver-from-plan / publish-delivery，它们内部都不调用 workflow()，故串接满足
//   "仅一层嵌套"约束）。阶段间有确定性闸门；正常全自动推进，仅遇到【无法安全推断的关键歧义/方案红线/缺发布
//   权限】才暂停升级人工。设计真相源见「全自动AI软件交付流水线-分析与改造方案.md」第 7/10 节。
//
// 运行：
//   Workflow({ scriptPath: ".../.claude/workflows/auto-deliver.js", args: {
//     requirement: "<需求描述，必填>", target: "<目标仓库本地路径，必填>",
//     constraints: ["<约束>"], mode: "lite|standard|deep",
//     remoteUrl: "<push 的远程；省略取 target 的 origin>",
//     gitPolicy: { branchMode, branchPrefix, targetBranch, allowMainPush, pushRemote },
//     authorName, authorEmail, commitMessage,
//     allowHighRiskAutoPublish: false, dryRunPublish: false,
//     planArgs: {}, deliverArgs: {}, publishArgs: {},   // 透传给各子引擎的额外参数
//     workflowsDir: "<.claude/workflows 绝对路径>"        // 可选：按名解析子引擎失败时回退 scriptPath（非本仓库项目上下文运行时需要）
//   }})
// 运行时事实：args 到脚本是 JSON 字符串需 parse；脚本体无文件 IO/时间 API；子引擎各自落盘，编排器只串状态与产物目录。

export const meta = {
  name: 'auto-deliver',
  description: '端到端编排器：一句需求 → plan-from-requirement →(就绪闸门)→ deliver-from-plan →(交付闸门)→ publish-delivery → 汇总最终交付（不建 PR）。用一层 workflow() 串三引擎；正常全自动，仅关键歧义/方案红线/缺权限才暂停升级人工。',
  whenToUse: '想用「目标仓库 + 一段需求」一键跑完 需求→方案→测试→编码→评审→修复→验证→建分支→commit→push（不建 PR），各阶段间自动就绪/交付闸门、仅关键歧义才暂停时',
  phases: [
    { title: 'Plan', detail: 'workflow(plan-from-requirement)：需求→可执行方案（含 readinessForDev）' },
    { title: 'ReadinessGate', detail: '确定性：PASS/PARTIAL + ready 才进编码；NEEDS_CLARIFICATION 暂停升级人工' },
    { title: 'Deliver', detail: 'workflow(deliver-from-plan)：沙箱写码到测试全绿+独立验证→已验证 diff' },
    { title: 'DeliveryGate', detail: '确定性：DELIVERED/带开环项 才进发布；否则停' },
    { title: 'Publish', detail: 'workflow(publish-delivery)：自动建分支/commit/push + 远程核验（不建 PR）' },
    { title: 'Finalize', detail: '汇总三段结果为端到端总报告' },
  ],
}

// ===================== 参数（args 为 JSON 字符串，先 parse）=====================
const A = (() => {
  let a = args
  if (typeof a === 'string') { try { a = a.trim() ? JSON.parse(a) : {} } catch (e) { a = {} } }
  return (a && typeof a === 'object') ? a : {}
})()
const requirement = A.requirement ? String(A.requirement) : null
const target = A.target ? String(A.target) : null
const constraints = Array.isArray(A.constraints) ? A.constraints.map(String) : (A.constraints ? [String(A.constraints)] : [])
const mode = ['lite', 'standard', 'deep'].includes(String(A.mode || '').toLowerCase()) ? String(A.mode).toLowerCase() : undefined
const remoteUrl = A.remoteUrl ? String(A.remoteUrl) : undefined
const gitPolicy = (A.gitPolicy && typeof A.gitPolicy === 'object') ? A.gitPolicy : {}
const authorName = A.authorName ? String(A.authorName) : undefined
const authorEmail = A.authorEmail ? String(A.authorEmail) : undefined
const commitMessage = A.commitMessage ? String(A.commitMessage) : undefined
const allowHighRiskAutoPublish = !!A.allowHighRiskAutoPublish
const dryRunPublish = !!A.dryRunPublish
const planArgs = (A.planArgs && typeof A.planArgs === 'object') ? A.planArgs : {}
const deliverArgs = (A.deliverArgs && typeof A.deliverArgs === 'object') ? A.deliverArgs : {}
const publishArgs = (A.publishArgs && typeof A.publishArgs === 'object') ? A.publishArgs : {}
// 子引擎脚本所在目录（可选）：用于"按名解析失败时回退 scriptPath"，使编排器在非本仓库项目上下文也能运行。
const workflowsDir = A.workflowsDir ? String(A.workflowsDir) : null

const execLog = []
function note(m) { execLog.push(m); log(m) }

// 子工作流解析：优先按名（本仓库作为活动项目时可用，最便携）；按名失败且提供了 workflowsDir，则回退到
// scriptPath（任意项目上下文都能跑）。子引擎内部都不调用 workflow()，故无论哪条路径都满足"仅一层嵌套"。
async function runChild(name, childArgs) {
  try {
    return await workflow(name, childArgs)
  } catch (e) {
    const msg = String((e && e.message) || e)
    if (workflowsDir && /no workflow with that name|not found|unknown workflow|cannot find|no such workflow/i.test(msg)) {
      note(`workflow('${name}') 按名解析失败，回退 scriptPath：${workflowsDir}/${name}.js`)
      return await workflow({ scriptPath: `${workflowsDir}/${name}.js` }, childArgs)
    }
    throw e
  }
}

// 确定性闸门（纯 JS，不依赖子代理自述）
function planReady(planRes) {
  return !!planRes && ['PASS', 'PARTIAL'].includes(planRes.finalStatus) && planRes.readinessForDev === 'ready'
}
function deliveryPublishable(delRes) {
  return !!delRes && ['DELIVERED', 'DELIVERED_WITH_OPEN_ITEMS'].includes(delRes.finalStatus)
}

// ===================== 编排 =====================
let stage = 'Plan', finalStatus = 'FAILED', escalation = null
let planRes = null, delRes = null, pubRes = null, planDir = null, deliveryDir = null

try {
  if (!requirement) { finalStatus = 'INVALID_ARGS'; escalation = 'args.requirement 缺失（必填）' }
  else if (!target) { finalStatus = 'INVALID_ARGS'; escalation = 'args.target 缺失（必填）' }
  else {
    // ---- Plan ----
    phase('Plan')
    planRes = await runChild('plan-from-requirement', Object.assign({ requirement, target, constraints, mode }, planArgs))
    if (!planRes) { stage = 'Plan'; finalStatus = 'FAILED'; note('plan-from-requirement 未返回结果（子流程失败）。') }
    else {
      planDir = planRes.persisted && planRes.persisted.absOutDir ? planRes.persisted.absOutDir : null
      note(`Plan：finalStatus=${planRes.finalStatus}，readinessForDev=${planRes.readinessForDev}，planDir=${planDir || '(未落盘)'}。`)

      // ---- ReadinessGate（确定性 + 关键歧义升级）----
      phase('ReadinessGate')
      if (planRes.readinessForDev === 'needs-clarification' || planRes.finalStatus === 'NEEDS_CLARIFICATION') {
        stage = 'ReadinessGate'; finalStatus = 'NEEDS_CLARIFICATION'
        const bq = (planRes.triage && planRes.triage.blockingQuestions) || (planRes.manifest && planRes.manifest.blockingQuestions) || []
        escalation = `需求存在会实质改变实现语义的关键歧义，已暂停等待人工澄清（唯一允许的暂停点）。澄清清单见 ${planDir ? planDir + '/clarification.md' : '方案目录'}。阻断问题数=${bq.length}。请补充澄清后，用更新后的 requirement 重跑。`
        note('⏸ ReadinessGate：NEEDS_CLARIFICATION → 升级人工（不猜着进编码）。')
      } else if (!planReady(planRes)) {
        stage = 'ReadinessGate'; finalStatus = 'BLOCKED_AT_PLAN'
        note(`⛔ ReadinessGate：方案未就绪（需 PASS/PARTIAL 且 ready，实际 ${planRes.finalStatus}/${planRes.readinessForDev}），不进编码。请看方案报告返工。`)
      } else if (!planDir) {
        stage = 'ReadinessGate'; finalStatus = 'BLOCKED_AT_PLAN'
        note('⛔ ReadinessGate：方案未成功落盘（无 planDir），无法移交编码。')
      } else {
        note('✓ ReadinessGate：方案就绪，进入编码。')

        // ---- Deliver ----
        phase('Deliver')
        delRes = await runChild('deliver-from-plan', Object.assign({ planDir, targetRepo: target, mode }, deliverArgs))
        if (!delRes) { stage = 'Deliver'; finalStatus = 'FAILED'; note('deliver-from-plan 未返回结果（子流程失败）。') }
        else {
          deliveryDir = delRes.runDir || null
          note(`Deliver：finalStatus=${delRes.finalStatus}，deliveryDir=${deliveryDir || '(未落盘)'}。`)

          // ---- DeliveryGate（确定性）----
          phase('DeliveryGate')
          if (!deliveryPublishable(delRes)) {
            stage = 'DeliveryGate'; finalStatus = 'BLOCKED_AT_DELIVER'
            note(`⛔ DeliveryGate：交付未达可发布态（需 DELIVERED/带开环项，实际 ${delRes.finalStatus}），不发布。常见原因：实现未真绿/独立验证未过/触红线/改测试被拦——见交付报告。`)
          } else if (!deliveryDir) {
            stage = 'DeliveryGate'; finalStatus = 'BLOCKED_AT_DELIVER'
            note('⛔ DeliveryGate：交付未成功落盘（无 deliveryDir），无法移交发布。')
          } else {
            note('✓ DeliveryGate：交付已验证，进入发布。')

            // ---- Publish ----
            phase('Publish')
            pubRes = await runChild('publish-delivery', Object.assign({
              deliveryDir, targetRepo: target, remoteUrl, gitPolicy,
              authorName, authorEmail, commitMessage, allowHighRiskAutoPublish, dryRun: dryRunPublish,
            }, publishArgs))
            if (!pubRes) { stage = 'Publish'; finalStatus = 'FAILED'; note('publish-delivery 未返回结果（子流程失败）。') }
            else {
              stage = 'Publish'; finalStatus = pubRes.finalStatus
              note(`Publish：finalStatus=${pubRes.finalStatus}；分支=${pubRes.branch ? pubRes.branch.branchName : 'N/A'}；push=${!!(pubRes.push && pubRes.push.pushPerformed)}。`)
              if (pubRes.finalStatus === 'PUBLISH_NEEDS_CHOICE') escalation = '发布前需客户选择提交方式：(1) 新建分支 / (2) 切到客户指定的已有分支(需 gitPolicy.targetBranch) / (3) 当前分支直提。请带 gitPolicy.branchMode（"new-branch"/"switch-existing"/"current-branch"）重跑；未选择前不发布。'
              else if (pubRes.finalStatus === 'PUBLISH_BLOCKED') escalation = '发布被闸门拦截（高风险域/受保护分支/缺权限/交付未达标）。见发布报告中的"如何用 ! git push 自行完成"。'
              else if (pubRes.finalStatus === 'PUBLISH_UNVERIFIED') escalation = '已 push 但发布后远程核验未全过，未宣称成功，请人工核对远程状态。'
            }
          }
        }
      }
    }
  }
} catch (e) {
  finalStatus = 'FAILED'
  escalation = `编排在 ${stage} 阶段异常终止：${String((e && e.message) || e).slice(0, 200)}`
  note(escalation)
}

// ===================== Finalize（汇总总报告；子引擎各自已落盘明细）=====================
const summary = {
  schemaVersion: '1.0', workflow: 'auto-deliver',
  requirement, target, mode: mode || 'auto',
  reachedStage: stage, finalStatus, escalation,
  plan: planRes ? { finalStatus: planRes.finalStatus, readinessForDev: planRes.readinessForDev, planDir } : null,
  delivery: delRes ? { finalStatus: delRes.finalStatus, deliveryDir, filesChanged: (delRes.manifest && delRes.manifest.filesChanged) || [], browserVerify: (delRes.manifest && delRes.manifest.browserVerify) || null } : null,
  publish: pubRes ? {
    finalStatus: pubRes.finalStatus,
    branch: pubRes.branch ? pubRes.branch.branchName : null,
    pushed: !!(pubRes.push && pubRes.push.pushPerformed),
    remoteRef: pubRes.push ? pubRes.push.remoteRef : null,
    commit: pubRes.commit ? pubRes.commit.commitSha : null,
    remoteVerified: pubRes.remoteVerify || null,
    publishDir: pubRes.publishDir || null,
  } : null,
}

phase('Finalize')
const okToWrite = !!(planRes || delRes || pubRes)
if (okToWrite) {
  const fn = await agent(
    `你负责把端到端编排总结落盘（只写文件、绝不动远程或原仓库、绝不 commit/push）。\n` +
    `1) ts=$(date +%Y%m%d-%H%M%S)；dir="evidence/auto/$ts"；mkdir -p "$dir"；realpath 取绝对路径。\n` +
    `2) 写 "$dir/auto-deliver-summary.json"（规范 JSON，用下方对象原样）。\n` +
    `3) 写 "$dir/auto-deliver-report.md"（中文）：含 最终状态/到达阶段/各子阶段状态与产物目录/【真实浏览器验证：delivery.browserVerify 的 applicable 与 finalBrowserStatus（passed/failed/skipped-no-capability/not-applicable/error）、adapter、证据目录；非 web 写 not-applicable，无能力写 skipped 并注明剩余风险】/若 NEEDS_CLARIFICATION 列澄清去向/若发布失败列"如何自行完成"/各子引擎明细目录指引。\n` +
    `4) 写 "$dir/execution-log.md"（用下方日志数组）。\n` +
    `回报 ok/absOutDir/written/note。\nsummary(JSON):\n${JSON.stringify(summary)}\nexecution-log(JSON):\n${JSON.stringify(execLog)}`,
    { schema: { type: 'object', additionalProperties: false, properties: {
      ok: { type: 'boolean' }, absOutDir: { type: 'string' }, written: { type: 'array', items: { type: 'string' } }, note: { type: 'string' },
    }, required: ['ok', 'absOutDir', 'written', 'note'] }, label: 'auto-finalize', phase: 'Finalize', agentType: 'general-purpose', effort: 'low' })
  if (fn) note(`Finalize：${fn.ok ? '已写入 ' + fn.absOutDir + '（' + fn.written.length + ' 文件）' : '落盘失败：' + fn.note}`)
  summary.summaryDir = fn ? fn.absOutDir : null
} else {
  note('无任何子阶段产物（参数无效/最早期失败），仅返回结构化结果。')
}

log(`auto-deliver 完成。到达阶段=${stage}，最终状态=${finalStatus}${escalation ? '；需人工：' + escalation : ''}。`)

return summary
