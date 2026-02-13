import * as core from "@actions/core";
import * as github from "@actions/github";

interface PRTestResponse {
  prTestId: string;
  detailsUrl?: string;
  status: string;
  result?: string;
  runNumber?: number;
  previousRunCount?: number;
  issuesSummary?: {
    total: number;
    critical: number;
    warning: number;
    info: number;
  };
  affectedComponents?: Array<{ name: string; type: string }>;
  discoveryResults?: Array<{
    targetComponent: string;
    success: boolean;
    screenshotUrl?: string;
    duration: number;
    error?: string;
    browser?: string;
    viewport?: string;
    navigationPath?: Array<{ description: string }>;
    segmentScreenshots?: Array<{
      browser: string;
      viewport: string;
      componentName: string;
      screenshotUrl: string;
    }>;
  }>;
  segmentScreenshots?: Array<{
    browser: string;
    viewport: string;
    componentName: string;
    screenshotUrl: string;
  }>;
  interactionResults?: Array<{
    behaviorType: string;
    name: string;
    description: string;
    passed: boolean;
    browser: string;
    viewport: string;
    screenshotBefore?: string;
    screenshotAfter?: string;
    steps: Array<{
      action: string;
      description: string;
      success: boolean;
      error?: string;
    }>;
    issues: Array<{
      severity: string;
      title: string;
      description: string;
    }>;
    capturedRequests?: Array<{
      method: string;
      url: string;
      status?: number;
    }>;
  }>;
  functionalResults?: Array<{
    planId: string;
    planName: string;
    featureName: string;
    passed: boolean;
    browser: string;
    viewport: string;
    duration: number;
    scenarios: Array<{
      name: string;
      type: string;
      passed: boolean;
      stepResults: Array<{
        action: string;
        description: string;
        success: boolean;
        error?: string;
      }>;
      assertionResults: Array<{
        type: string;
        description: string;
        passed: boolean;
        expected?: string;
        actual?: string;
        error?: string;
      }>;
      capturedRequests: Array<{
        method: string;
        url: string;
        status?: number;
      }>;
      screenshotUrl?: string;
      issues: Array<{
        severity: string;
        title: string;
        description: string;
      }>;
    }>;
  }>;
  codeAnalysis?: {
    summary: string;
    features: Array<{
      name: string;
      type: string;
      description: string;
      confidence: number;
    }>;
    apiEndpoints: Array<{
      method: string;
      url: string;
      relatedFeature?: string;
    }>;
  };
  testOverview?: {
    summary: string;
    codeAnalysisSummary?: string;
    featuresIdentified: Array<{
      name: string;
      type: string;
      tested: boolean;
    }>;
    testsRun: Array<{
      name: string;
      type: string;
      result: 'passed' | 'failed';
      details: string;
      browser: string;
      viewport: string;
      duration: number;
    }>;
    formSubmissions: Array<{
      formName: string;
      fieldsFilled: Array<{ field: string; value: string }>;
      submitted: boolean;
      apiRequest?: {
        method: string;
        url: string;
        status?: number;
      };
      result: string;
    }>;
    totalDuration: number;
  };
  testCategories?: string[];
  testResults?: Array<{
    type: string;
    severity: string;
    title: string;
    description: string;
    suggestion?: string;
    status?: string;
  }>;
  scope?: string;
  error?: string;
}

async function run(): Promise<void> {
  try {
    const apiKey = core.getInput("api-key", { required: true });
    const apiUrl =
      "https://quali-bot--quali-bot-da8cd.europe-west4.hosted.app/api/v1";
    const orgId = core.getInput("org-id", { required: true });
    const projectId = core.getInput("project-id", { required: true });
    const targetUrl = core.getInput("target-url", { required: true });
    const waitForResults = core.getInput("wait-for-results") !== "false";
    const timeout = parseInt(core.getInput("timeout") || "1800", 10);
    const pollInterval = parseInt(core.getInput("poll-interval") || "30", 10);
    const failOnCritical = core.getInput("fail-on-critical") !== "false";
    const commentOnPR = core.getInput("comment-on-pr") !== "false";
    const githubToken = core.getInput("github-token");
    const browsers = (core.getInput("browsers") || "chrome")
      .split(",")
      .map((b) => b.trim().toLowerCase())
      .filter((b) => ["chrome", "firefox", "safari"].includes(b));
    const viewports = (core.getInput("viewports") || "1920x1080")
      .split(",")
      .map((v) => {
        const [w, h] = v.trim().split("x").map(Number);
        return w && h ? { width: w, height: h } : null;
      })
      .filter(Boolean) as Array<{ width: number; height: number }>;
    const scope = core.getInput("scope") || "pr-changes";
    const validTestCategories = ["visual", "interaction", "accessibility", "responsive", "performance"];
    const testTypes = (core.getInput("test-types") || "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter((t) => validTestCategories.includes(t));
    const excludeTests = (core.getInput("exclude-tests") || "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter((t) => validTestCategories.includes(t));

    const context = github.context;
    const pr = context.payload.pull_request;

    if (!pr) {
      core.warning("No pull request context found. Skipping QualiBot test.");
      return;
    }

    // Step 1: Trigger the test
    core.info(`Triggering QualiBot test for PR #${pr.number}...`);
    core.info(`Target URL: ${targetUrl}`);

    const triggerResponse = await fetch(`${apiUrl}/pr-tests`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        projectId,
        orgId,
        prNumber: pr.number,
        prTitle: pr.title,
        prUrl: pr.html_url,
        prAuthor: pr.user.login,
        prAuthorAvatar: pr.user.avatar_url,
        headBranch: pr.head.ref,
        baseBranch: pr.base.ref,
        headSha: pr.head.sha,
        targetUrl,
        browsers,
        viewports,
        scope,
        ...(testTypes.length > 0 ? { testCategories: testTypes } : {}),
        ...(excludeTests.length > 0 ? { excludeTests } : {}),
      }),
    });

    if (!triggerResponse.ok) {
      const errorBody = await triggerResponse.text();
      throw new Error(
        `Failed to trigger test (${triggerResponse.status}): ${errorBody}`,
      );
    }

    const triggerData = (await triggerResponse.json()) as PRTestResponse;
    const testId = triggerData.prTestId;
    const appBaseUrl = apiUrl.replace("/api/v1", "");
    // Use /view/:testId redirect — avoids org/project IDs in the URL
    // which would get masked by GitHub Actions secret redaction
    const dashboardUrl = `${appBaseUrl}/view/${testId}`;

    core.info(`Test triggered successfully: ${testId}`);
    core.setOutput("test-id", testId);
    core.setOutput("dashboard-url", dashboardUrl);

    // Step 2: Wait for results (if enabled)
    if (!waitForResults) {
      core.info("Not waiting for results (wait-for-results: false)");
      core.setOutput("status", "triggered");
      return;
    }

    core.info(
      `Waiting for results (timeout: ${timeout}s, poll every: ${pollInterval}s)...`,
    );

    const startTime = Date.now();
    let finalStatus = "timeout";
    let finalResult = "";
    let totalIssues = 0;
    let criticalIssues = 0;
    let testData: PRTestResponse | null = null;

    while (Date.now() - startTime < timeout * 1000) {
      await sleep(pollInterval * 1000);

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      core.info(`Checking status... (${elapsed}s elapsed)`);

      const statusResponse = await fetch(
        `${apiUrl}/pr-tests/${testId}?projectId=${projectId}`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
        },
      );

      if (!statusResponse.ok) {
        core.warning(
          `Status check failed (${statusResponse.status}), retrying...`,
        );
        continue;
      }

      const responseData = (await statusResponse.json()) as {
        prTest?: PRTestResponse;
      };
      testData = (responseData.prTest || responseData) as PRTestResponse;
      core.info(`Status: ${testData.status}`);

      if (testData.status === "completed" || testData.status === "failed") {
        finalStatus = testData.status;
        finalResult = testData.result || "unknown";
        totalIssues = testData.issuesSummary?.total || 0;
        criticalIssues = testData.issuesSummary?.critical || 0;
        break;
      }
    }

    // Set outputs
    core.setOutput("status", finalStatus);
    core.setOutput("result", finalResult);
    core.setOutput("total-issues", totalIssues.toString());
    core.setOutput("critical-issues", criticalIssues.toString());

    // Step 3: Post PR comment (if enabled)
    if (commentOnPR && githubToken) {
      await postComment(githubToken, context, {
        status: finalStatus,
        result: finalResult,
        totalIssues,
        criticalIssues,
        components: testData?.affectedComponents?.length || 0,
        targetUrl,
        dashboardUrl,
        discoveries: testData?.discoveryResults || [],
        issues: testData?.testResults || [],
        segmentScreenshots: testData?.segmentScreenshots || [],
        interactionResults: testData?.interactionResults || [],
        functionalResults: testData?.functionalResults || [],
        codeAnalysis: testData?.codeAnalysis || null,
        testOverview: testData?.testOverview || null,
        testCategories: testData?.testCategories || [],
        runNumber: testData?.runNumber || 1,
        scope,
      });
    }

    // Step 4: Log summary
    logSummary(
      finalStatus,
      finalResult,
      totalIssues,
      criticalIssues,
      dashboardUrl,
    );

    // Step 5: Fail if criteria met
    if (finalStatus === "timeout") {
      core.setFailed(
        "QualiBot test timed out. Check the dashboard for details.",
      );
      return;
    }

    if (finalStatus === "failed") {
      core.setFailed(
        `QualiBot test failed: ${testData?.error || "Unknown error"}`,
      );
      return;
    }

    if (failOnCritical && criticalIssues > 0) {
      core.setFailed(
        `QualiBot found ${criticalIssues} critical visual issue(s).`,
      );
      return;
    }

    core.info("QualiBot visual testing completed successfully.");
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unexpected error occurred");
    }
  }
}

async function postComment(
  token: string,
  context: typeof github.context,
  data: {
    status: string;
    result: string;
    totalIssues: number;
    criticalIssues: number;
    components: number;
    targetUrl: string;
    dashboardUrl: string;
    discoveries: PRTestResponse["discoveryResults"];
    issues: PRTestResponse["testResults"];
    segmentScreenshots: PRTestResponse["segmentScreenshots"];
    interactionResults: PRTestResponse["interactionResults"];
    functionalResults: PRTestResponse["functionalResults"];
    codeAnalysis: PRTestResponse["codeAnalysis"] | null;
    testOverview: PRTestResponse["testOverview"] | null;
    testCategories: string[];
    runNumber: number;
    scope: string;
  },
): Promise<void> {
  try {
    const octokit = github.getOctokit(token);

    let emoji: string;
    let title: string;
    let details: string;

    if (data.status === "timeout") {
      emoji = "⏱️";
      title = "Test Timed Out";
      details = "The visual test did not complete within the timeout period.";
    } else if (data.result === "passed") {
      emoji = "✅";
      title = "Visual Tests Passed";
      details = `All visual tests passed. **${data.components}** component(s) tested.`;
    } else if (data.criticalIssues > 0) {
      emoji = "🚨";
      title = "Critical Visual Issues Found";
      details = `**${data.totalIssues}** issue(s) found (**${data.criticalIssues}** critical) across **${data.components}** component(s).`;
    } else if (data.totalIssues > 0) {
      emoji = "⚠️";
      title = "Visual Issues Found";
      details = `**${data.totalIssues}** issue(s) found across **${data.components}** component(s).`;
    } else {
      emoji = "❌";
      title = "Visual Tests Failed";
      details = "The test encountered errors during execution.";
    }

    const lines = [
      `## ${emoji} QualiBot: ${title}${data.runNumber > 1 ? ` (Run #${data.runNumber})` : ''}`,
      "",
      details,
      "",
      `| | |`,
      `|---|---|`,
      `| **Preview URL** | ${data.targetUrl} |`,
      `| **Issues** | ${data.totalIssues} total, ${data.criticalIssues} critical |`,
      `| **Components** | ${data.components} tested |`,
      `| **Scope** | ${data.scope === 'pr-changes' ? 'PR Changes Only' : 'Full Page'} |`,
    ];

    if (data.testCategories.length > 0) {
      lines.push(`| **Test Types** | ${data.testCategories.join(', ')} |`);
    }

    if (data.runNumber > 1) {
      lines.push(`| **Run** | #${data.runNumber} (includes context from ${data.runNumber - 1} previous run${data.runNumber - 1 > 1 ? 's' : ''}) |`);
    }

    // Test Overview section — shows what was actually tested
    if (data.testOverview) {
      const ov = data.testOverview;
      lines.push("", "### Test Overview");
      lines.push("");
      lines.push(`> ${ov.summary}`);

      if (ov.codeAnalysisSummary) {
        lines.push("");
        lines.push(`**Code Analysis:** ${ov.codeAnalysisSummary}`);
      }

      if (ov.featuresIdentified.length > 0) {
        lines.push("");
        lines.push("**Features Identified:**");
        for (const feature of ov.featuresIdentified) {
          const tested = feature.tested ? "✅ tested" : "⏭️ not tested";
          lines.push(`- **${feature.name}** (${feature.type}) — ${tested}`);
        }
      }

      if (ov.formSubmissions.length > 0) {
        lines.push("");
        lines.push("**Form Submissions:**");
        for (const fs of ov.formSubmissions) {
          const icon = fs.submitted ? "✅" : "❌";
          lines.push(`${icon} **${fs.formName}**`);

          if (fs.fieldsFilled.length > 0) {
            lines.push("");
            lines.push("| Field | Value |");
            lines.push("|---|---|");
            for (const field of fs.fieldsFilled) {
              lines.push(`| ${field.field} | ${field.value} |`);
            }
          }

          if (fs.apiRequest) {
            const statusIcon = !fs.apiRequest.status ? "⏳" : fs.apiRequest.status < 400 ? "✅" : "❌";
            lines.push(`${statusIcon} \`${fs.apiRequest.method} ${fs.apiRequest.url.split('?')[0]}\` → ${fs.apiRequest.status || 'pending'}`);
          }
          lines.push(`Result: **${fs.result}**`);
          lines.push("");
        }
      }

      if (ov.testsRun.length > 0) {
        lines.push("**Tests Executed:**");
        for (const test of ov.testsRun) {
          const icon = test.result === 'passed' ? '✅' : '❌';
          lines.push(`- ${icon} **${test.name}** [${test.browser} @ ${test.viewport}] (${(test.duration / 1000).toFixed(1)}s)`);
          lines.push(`  ${test.details}`);
        }
        lines.push("");
      }

      lines.push(`**Total Duration:** ${(ov.totalDuration / 1000).toFixed(1)}s`);
      lines.push("");
    }

    // Add segment screenshots for pr-changes scope
    if (data.scope === 'pr-changes' && data.segmentScreenshots && data.segmentScreenshots.length > 0) {
      lines.push("", "### Changed Segment Screenshots");
      lines.push("");
      lines.push("Screenshots of the changed component segments across all tested browsers and viewports:");
      lines.push("");

      // Group by component name
      const byComponent = new Map<string, typeof data.segmentScreenshots>();
      for (const seg of data.segmentScreenshots!) {
        const existing = byComponent.get(seg.componentName) || [];
        existing.push(seg);
        byComponent.set(seg.componentName, existing);
      }

      for (const [componentName, segments] of byComponent) {
        lines.push(`<details>`);
        lines.push(`<summary><strong>${componentName}</strong> (${segments.length} screenshot${segments.length > 1 ? 's' : ''})</summary>`);
        lines.push("");
        for (const seg of segments) {
          lines.push(`**${seg.browser} @ ${seg.viewport}**`);
          lines.push("");
          lines.push(`![${componentName} - ${seg.browser} ${seg.viewport}](${seg.screenshotUrl})`);
          lines.push("");
        }
        lines.push(`</details>`);
        lines.push("");
      }
    }

    // Add discovery screenshots
    if (data.discoveries && data.discoveries.length > 0) {
      lines.push("", "### Full Page Screenshots");
      for (const discovery of data.discoveries) {
        const statusIcon = discovery.success ? "✅" : "❌";
        const browserInfo = discovery.browser && discovery.viewport
          ? ` [${discovery.browser} @ ${discovery.viewport}]`
          : '';
        lines.push("", `**${statusIcon} ${discovery.targetComponent}${browserInfo}**`);
        if (discovery.screenshotUrl) {
          lines.push(
            "",
            `![${discovery.targetComponent}](${discovery.screenshotUrl})`,
          );
        }
        if (discovery.error) {
          lines.push(`> ${discovery.error}`);
        }
      }
    }

    // Add code analysis summary
    if (data.codeAnalysis && data.codeAnalysis.features.length > 0) {
      lines.push("", "### Code Analysis");
      lines.push("");
      lines.push(`> ${data.codeAnalysis.summary}`);
      lines.push("");
      lines.push("**Features identified from code:**");
      for (const feature of data.codeAnalysis.features) {
        const typeEmoji: Record<string, string> = {
          form: "📝", navigation: "🔗", modal: "🪟", dropdown: "📋",
          toggle: "🔀", search: "🔍", list: "📃", crud: "🗃️",
          auth: "🔐", upload: "📤", other: "🔧"
        };
        lines.push(`- ${typeEmoji[feature.type] || "🔧"} **${feature.name}** (${feature.type}) — ${feature.description.slice(0, 120)}`);
      }
      if (data.codeAnalysis.apiEndpoints.length > 0) {
        lines.push("");
        lines.push("**API endpoints detected:**");
        for (const ep of data.codeAnalysis.apiEndpoints) {
          lines.push(`- \`${ep.method} ${ep.url}\`${ep.relatedFeature ? ` → ${ep.relatedFeature}` : ''}`);
        }
      }
      lines.push("");
    }

    // Add functional test results
    if (data.functionalResults && data.functionalResults.length > 0) {
      lines.push("", "### Functional Tests");
      lines.push("");

      const totalScenarios = data.functionalResults.reduce((sum, fr) => sum + fr.scenarios.length, 0);
      const passedScenarios = data.functionalResults.reduce(
        (sum, fr) => sum + fr.scenarios.filter(s => s.passed).length, 0
      );
      const failedScenarios = totalScenarios - passedScenarios;

      lines.push(`**${passedScenarios}** passed, **${failedScenarios}** failed out of **${totalScenarios}** test scenario(s) across **${data.functionalResults.length}** feature(s)`);
      lines.push("");

      for (const result of data.functionalResults) {
        const icon = result.passed ? "✅" : "❌";
        lines.push(`<details>`);
        lines.push(`<summary>${icon} <strong>${result.featureName}</strong> [${result.browser} @ ${result.viewport}] — ${result.scenarios.length} scenario(s)</summary>`);
        lines.push("");

        for (const scenario of result.scenarios) {
          const scenarioIcon = scenario.passed ? "✅" : "❌";
          const typeLabel: Record<string, string> = {
            "happy-path": "🟢 Happy Path",
            "validation": "🟡 Validation",
            "edge-case": "🟠 Edge Case",
            "error-handling": "🔴 Error Handling",
            "accessibility": "♿ Accessibility"
          };

          lines.push(`#### ${scenarioIcon} ${typeLabel[scenario.type] || scenario.type}: ${scenario.name}`);
          lines.push("");

          // Steps
          if (scenario.stepResults.length > 0) {
            lines.push("**Steps:**");
            for (const step of scenario.stepResults) {
              const stepIcon = step.success ? "✅" : "❌";
              lines.push(`${stepIcon} ${step.description}${step.error ? ` — _${step.error}_` : ""}`);
            }
            lines.push("");
          }

          // Assertions
          const failedAssertions = scenario.assertionResults.filter(a => !a.passed);
          if (failedAssertions.length > 0) {
            lines.push("**Failed Assertions:**");
            for (const assertion of failedAssertions) {
              lines.push(`❌ ${assertion.description}`);
              if (assertion.expected) lines.push(`  Expected: ${assertion.expected}`);
              if (assertion.actual) lines.push(`  Actual: ${assertion.actual}`);
            }
            lines.push("");
          }

          // Network requests
          if (scenario.capturedRequests.length > 0) {
            lines.push("**Network Requests:**");
            for (const req of scenario.capturedRequests) {
              const statusIcon = !req.status ? "⏳" : req.status < 400 ? "✅" : "❌";
              lines.push(`${statusIcon} \`${req.method} ${req.url.split('?')[0]}\` → ${req.status || 'pending'}`);
            }
            lines.push("");
          }

          // Screenshot
          if (scenario.screenshotUrl) {
            lines.push(`![${scenario.name}](${scenario.screenshotUrl})`);
            lines.push("");
          }

          // Issues
          if (scenario.issues.length > 0) {
            lines.push("**Issues:**");
            for (const issue of scenario.issues) {
              const sev = issue.severity === "critical" ? "🔴" : issue.severity === "warning" ? "🟡" : "🔵";
              lines.push(`- ${sev} ${issue.title}: ${issue.description.slice(0, 120)}`);
            }
            lines.push("");
          }
        }

        lines.push(`</details>`);
        lines.push("");
      }
    }

    // Add interaction test results
    if (data.interactionResults && data.interactionResults.length > 0) {
      lines.push("", "### Interaction Tests");
      lines.push("");

      const passed = data.interactionResults.filter((r) => r.passed).length;
      const failed = data.interactionResults.length - passed;
      lines.push(`**${passed}** passed, **${failed}** failed out of **${data.interactionResults.length}** interaction test(s)`);
      lines.push("");

      for (const result of data.interactionResults) {
        const icon = result.passed ? "✅" : "❌";
        const typeEmoji = {
          form: "📝",
          navigation: "🔗",
          modal: "🪟",
          dropdown: "📋",
          toggle: "🔀",
          animation: "✨",
          "api-call": "🌐",
          other: "🔧",
        }[result.behaviorType] || "🔧";

        lines.push(`<details>`);
        lines.push(`<summary>${icon} ${typeEmoji} <strong>${result.name}</strong> [${result.browser} @ ${result.viewport}]</summary>`);
        lines.push("");
        lines.push(`> ${result.description}`);
        lines.push("");

        if (result.steps.length > 0) {
          lines.push("**Steps:**");
          for (const step of result.steps) {
            const stepIcon = step.success ? "✅" : "❌";
            lines.push(`${stepIcon} ${step.description}${step.error ? ` — _${step.error}_` : ""}`);
          }
          lines.push("");
        }

        if (result.capturedRequests && result.capturedRequests.length > 0) {
          lines.push("**Network Requests:**");
          for (const req of result.capturedRequests) {
            const statusIcon = !req.status ? "⏳" : req.status < 400 ? "✅" : "❌";
            lines.push(`${statusIcon} \`${req.method} ${req.url.split('?')[0]}\` → ${req.status || 'pending'}`);
          }
          lines.push("");
        }

        if (result.screenshotBefore || result.screenshotAfter) {
          if (result.screenshotBefore) {
            lines.push(`**Before:** ![Before](${result.screenshotBefore})`);
          }
          if (result.screenshotAfter) {
            lines.push(`**After:** ![After](${result.screenshotAfter})`);
          }
          lines.push("");
        }

        if (result.issues.length > 0) {
          lines.push("**Issues:**");
          for (const issue of result.issues) {
            const sev = issue.severity === "critical" ? "🔴" : issue.severity === "warning" ? "🟡" : "🔵";
            lines.push(`- ${sev} ${issue.title}: ${issue.description.slice(0, 120)}`);
          }
          lines.push("");
        }

        lines.push(`</details>`);
        lines.push("");
      }
    }

    // Add issues detail
    if (data.issues && data.issues.length > 0) {
      lines.push("", "### Issues Found");
      lines.push("", "| Severity | Type | Title | Description | Status |");
      lines.push("|---|---|---|---|---|");
      for (const issue of data.issues.slice(0, 10)) {
        const severityIcon =
          issue.severity === "critical"
            ? "🔴"
            : issue.severity === "warning"
              ? "🟡"
              : "🔵";
        const statusLabel = issue.status
          ? issue.status === 'regressed' ? '⬆️ Regressed'
            : issue.status === 'recurring' ? '🔄 Recurring'
            : '🆕 New'
          : '';
        lines.push(
          `| ${severityIcon} ${issue.severity} | ${issue.type} | ${issue.title} | ${issue.description.slice(0, 100)} | ${statusLabel} |`,
        );
      }
      if (data.issues.length > 10) {
        lines.push("", `_...and ${data.issues.length - 10} more issues_`);
      }
    }

    lines.push("", `[View Full Results →](${data.dashboardUrl})`);

    const body = lines.join("\n");

    await octokit.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: context.payload.pull_request!.number,
      body,
    });

    core.info("Posted results comment on PR.");
  } catch (error) {
    core.warning(`Failed to post PR comment: ${error}`);
  }
}

function logSummary(
  status: string,
  result: string,
  totalIssues: number,
  criticalIssues: number,
  dashboardUrl: string,
): void {
  const emoji = result === 'passed' ? '✅' : criticalIssues > 0 ? '🚨' : totalIssues > 0 ? '⚠️' : '❌';
  const summaryMd = [
    `## ${emoji} QualiBot Visual Testing Results`,
    '',
    '| Status | Result | Issues | Critical |',
    '|--------|--------|--------|----------|',
    `| ${status} | ${result} | ${totalIssues} | ${criticalIssues} |`,
    '',
    `[View Full Results →](${dashboardUrl})`,
  ].join('\n');

  core.summary
    .addRaw(summaryMd)
    .write();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

run();
