import * as core from "@actions/core";
import * as github from "@actions/github";

interface PRTestResponse {
  prTestId: string;
  status: string;
  result?: string;
  issuesSummary?: {
    total: number;
    critical: number;
    warning: number;
    info: number;
  };
  affectedComponents?: Array<{ name: string; type: string }>;
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

    core.info(`Test triggered successfully: ${testId}`);
    core.setOutput("test-id", testId);

    const dashboardUrl = `${apiUrl.replace("/api/v1", "")}/org/${orgId}/project/${projectId}/pr-test/${testId}`;
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

      const responseData = (await statusResponse.json()) as { prTest?: PRTestResponse };
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

    const body = [
      `## ${emoji} QualiBot: ${title}`,
      "",
      details,
      "",
      `| | |`,
      `|---|---|`,
      `| **Preview URL** | ${data.targetUrl} |`,
      `| **Issues** | ${data.totalIssues} total, ${data.criticalIssues} critical |`,
      `| **Components** | ${data.components} tested |`,
      "",
      `[View Full Results →](${data.dashboardUrl})`,
    ].join("\n");

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
  core.summary
    .addHeading("QualiBot Visual Testing Results")
    .addTable([
      [
        { data: "Status", header: true },
        { data: "Result", header: true },
        { data: "Issues", header: true },
        { data: "Critical", header: true },
      ],
      [status, result, totalIssues.toString(), criticalIssues.toString()],
    ])
    .addLink("View Full Results", dashboardUrl)
    .write();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

run();
