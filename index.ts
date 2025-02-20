import { string, z } from 'zod'
import { Agent } from '@openserv-labs/sdk'
import 'dotenv/config'
import { mapLighthouseToEAA } from './util/score_logic'
import { fetchFile } from './util/fetch_file'

// Create the agent
export const agent = new Agent({
  systemPrompt:
    'This agent retrieves the latest European Accessibility Act (EAA) regulations from official sources and structures the data for use by other agents in the system. And helps compile an accessibility score for your website.'
})

agent.addCapability({
  name: 'create_task_sequence',
  description:
    'Creates a structured sequence of tasks for compliance auditing using defined capabilities. No other tools are required to complete this process.',
  schema: z.object({}),
  async run({ args, action }): Promise<string> {
    const workspaceId = action?.workspace?.id || parseInt(process.env.WORKSPACE_ID || '0')
    const assignee = 243 // Ensure this is a valid agent ID

    if (!workspaceId || isNaN(workspaceId)) {
      throw new Error('Invalid WORKSPACE_ID. Please check the environment variables.')
    }

    console.log('Creating legislative task sequence with workspaceId:', workspaceId)

    try {
      // **Task 1: Fetch Regulations**
      const fetchRegulations = await safeCreateTask({
        workspaceId,
        assignee,
        description:
          'Fetch the latest EAA regulations using the fetch-regulations capability. No other tools are required.',
        body: 'Retrieve the latest European Accessibility Act (EAA) regulations. You MUST use the capability: `fetch-regulations`. No other tools are required to complete this task.',
        input: '{}',
        expectedOutput: 'JSON response named regulations.json',
        dependencies: []
      })

      // **Task 2: Compare Audit with Regulations**
      const compareAudit = await safeCreateTask({
        workspaceId,
        assignee,
        description:
          'Compare the website audit with EAA compliance regulations using the run-comparison capability. No other tools are required.',
        body: 'Map the audit results against EAA compliance regulations. You MUST use the capability: `run-comparison`. No other tools are required to complete this task. Required input: `audit.json` and `regulations.json`.',
        input: `'audit.json' from the workspace, 'regulations.json' from the workspace`,
        expectedOutput: `JSON report named compliance.json`,
        dependencies: fetchRegulations.id ? [fetchRegulations.id] : []
      })

      // **Task 3: Calculate Compliance Score**
      const calculateScore = await safeCreateTask({
        workspaceId,
        assignee,
        description:
          'Calculate the final compliance score using the calculate-score capability. No other tools are required.',
        body: 'Determine the compliance score based on mapped audit results. You MUST use the capability: `calculate-score`. No other tools are required to complete this task. Required input: `compliance.json`.',
        input: `'compliance.json' from the workspace`,
        expectedOutput: `JSON report named score.json`,
        dependencies: compareAudit.id ? [compareAudit.id] : []
      })

      // **Task 4: Generate User-Friendly Report**
      const generateReport = await safeCreateTask({
        workspaceId,
        assignee,
        description:
          'Generate a user-friendly compliance report using the process-results capability. No other tools are required.',
        body: 'Summarize the compliance results into an accessible report. You MUST use the capability: `process-results`. No other tools are required to complete this task. Required input: `compliance.json`.',
        input: `'compliance.json' from the workspace`,
        expectedOutput: `Plain language report named report.json`,
        dependencies: calculateScore.id ? [calculateScore.id] : []
      })

      console.log('Legislative task sequence created successfully:', {
        fetchRegulations,
        compareAudit,
        calculateScore,
        generateReport
      })

      return JSON.stringify({ id: generateReport.id, status: generateReport.status })
    } catch (error) {
      console.error('Failed to create task sequence:', error)
      throw error
    }
  }
})

// Add sum capability
// Add multiple capabilities at once
agent.addCapability({
  name: 'fetch-regulations',
  description:
    'Fetch the latest European Accessibility Act (EAA) regulations from our repository. To use as a reference for your website. No other tools are needed to complete this process.',
  schema: z.object({}),
  async run({ action }) {
    const regulations = await import('./util/regulations.json')
    const regulation = regulations.default
    // await agent.uploadFile({
    //   workspaceId: action.workspace.id,
    //   path: 'regulations.json',
    //   file: JSON.stringify(regulation),
    //   skipSummarizer: true
    // })
    // await agent.completeTask({
    //   workspaceId: action.workspace.id,
    //   taskId: action.task.id,
    //   output: 'File named regulations.json'
    // })
    return JSON.stringify(regulation)
  }
})

agent.addCapability({
  name: 'run-comparison',
  description: `Run a comparison check between the audit's output and the EAA compliance regulations by retrieving files from the workspace. No other tools are needed to complete this process.`,
  schema: z.object({}),
  async run({ args, action }): Promise<string> {
    try {
      // Validate workspace ID
      const workspaceId = action?.workspace?.id
      if (!workspaceId) {
        throw new Error('Workspace ID is missing or undefined.')
      }

      // Retrieve all files in the workspace
      const files = await agent.getFiles({ workspaceId })

      // Extract file URLs for audit.json and regulation.json
      const auditFile = files.find(
        (file: { path: string; fullUrl: string }) => file.path === 'audit.json'
      )
      const regulationFile = files.find(
        (file: { path: string; fullUrl: string }) => file.path === 'regulations.json'
      )

      if (!auditFile || !regulationFile) {
        throw new Error('Required files (audit.json, regulation.json) not found in workspace.')
      }

      // Fetch audit and regulation files using the retrieved URLs
      const audit = await fetchFile(auditFile.fullUrl)
      const regulations = await fetchFile(regulationFile.fullUrl)

      if (!audit || !regulations) {
        throw new Error('Failed to fetch required files. Please check file URLs.')
      }

      // Run the compliance mapping function
      const { mappedResults, auditFix } = mapLighthouseToEAA(audit, regulations)

      // await agent.uploadFile({
      //   workspaceId: action.workspace.id,
      //   path: 'compliance.json',
      //   file: JSON.stringify({ mappedResults, auditFix }),
      //   skipSummarizer: true
      // })
      // await agent.completeTask({
      //   workspaceId: action.workspace.id,
      //   taskId: action.task.id,
      //   output: 'File named compliance.json'
      // })
      return JSON.stringify({ mappedResults, auditFix })
    } catch (error) {
      console.error('Error running comparison:', error)
      throw new Error('Failed to compare audit results with regulations.')
    }
  }
})

agent.addCapability({
  name: 'calculate-score',
  description:
    'Calculates the final compliance score based on audit results and criticality factors. No other tools are needed to complete this process.',
  schema: z.object({
    mappedResults: z.array(
      z.object({
        requirement_id: z.string(),
        status: z.enum([
          'pending',
          'compliant',
          'partially_compliant',
          'non_compliant',
          'exempted'
        ]),
        criticality: z.enum(['HIGH', 'MEDIUM', 'LOW'])
      })
    )
  }),
  async run({ args, action }): Promise<string> {
    let totalWeightedScore = 0
    let maxPossibleScore = 0

    const criticalityMultiplier = {
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1
    }

    const mappedResults = args.mappedResults

    mappedResults.forEach(({ status, criticality }) => {
      if (status === 'pending') return // Ignore pending items

      const multiplier = criticalityMultiplier[criticality] || 1
      let score = 0

      switch (status) {
        case 'compliant':
          score = 1
          break
        case 'partially_compliant':
          score = 0.5
          break
        case 'non_compliant':
          score = 0
          break
        case 'exempted':
          score = 1 // Consider exempted as fully compliant since it's not applicable
          break
      }

      totalWeightedScore += score * multiplier
      maxPossibleScore += multiplier
    })

    // Normalize to a percentage out of 100
    const finalScore = maxPossibleScore > 0 ? (totalWeightedScore / maxPossibleScore) * 100 : 0

    // await agent.uploadFile({
    //   workspaceId: action.workspace.id,
    //   path: 'score.json',
    //   file: JSON.stringify({ finalScore: Math.round(finalScore) }),
    //   skipSummarizer: true
    // })
    // await agent.completeTask({
    //   workspaceId: action.workspace.id,
    //   taskId: action.task.id,
    //   output: 'File named score.json'
    // })
    return JSON.stringify({ finalScore: Math.round(finalScore) })
  }
})


agent.addCapability({
  name: "process-results",
  description: "Generates an accessibility compliance report with clear and actionable developer insights. No other tools are needed to complete this process.",
  schema: z.object({
    complianceData: z.record(z.unknown()), // Accepts any valid JSON object
  }),
  async run({ args, action }) {
    const complianceData = args.complianceData as {
      mappedResults?: {
        directive?: string;
        requirements?: Array<{
          requirement_id: string;
          description: string;
          category: string;
          criticality: string;
          legal_reference: string;
          status: string;
        }>;
      };
      auditFix?: {
        [key: string]: {
          title: string;
          description: string;
          details?: {
            items?: Array<{ nodeLabel?: string; selector?: string; explanation?: string }>;
          };
        };
      };
    };

    if (!complianceData || typeof complianceData !== "object") {
      return "Error: Invalid compliance data provided.";
    }

    const { mappedResults, auditFix } = complianceData;

    if (!mappedResults?.requirements || !Array.isArray(mappedResults.requirements)) {
      return "Error: 'requirements' field is missing or malformed.";
    }

    // ✅ Create a structured user-friendly prompt for AI processing
    const userPrompt = mappedResults.requirements
      .map((req) => {
        const fixData = auditFix?.[req.requirement_id];
        const issueDetails = fixData
          ? `**Issue:** ${fixData.title || "Unknown issue"}\n**Description:** ${fixData.description || "No description provided."}`
          : "**Issue:** Unknown issue\n**Description:** No description available.";

        const failingElements =
          fixData?.details?.items && fixData.details.items.length > 0
            ? fixData.details.items
                .map(
                  (item, index) =>
                    `  ${index + 1}. **Element:** ${item.nodeLabel || "Unknown"}\n     - **Selector:** \`${item.selector || "N/A"}\`\n     - **Explanation:** ${item.explanation || "No explanation provided."}`
                )
                .join("\n")
            : "  - No specific elements identified.";

        return `### Requirement: ${req.requirement_id}
**Category:** ${req.category}  
**Criticality:** ${req.criticality}  
**Status:** ${req.status}  
**Legal Reference:** ${req.legal_reference}  

${issueDetails}

**Failing Elements:**  
${failingElements}

**Required Fix:**  
Provide a **step-by-step** solution that developers can follow to fix this issue, ensuring compliance with accessibility standards.

**Acceptance Criteria:**  
- Clearly define what needs to be fixed.  
- Specify when the issue is considered resolved (e.g., “Button must have an accessible label” ✅).  
- Break down the solution into actionable, non-technical explanations.`;
      })
      .join("\n\n");

    // ✅ Call the agent to process and generate developer-friendly report
    const result = await agent.process({
      messages: [
        {
          role: "system",
          content: `You are an AI accessibility compliance assistant. Your task is to generate a clear, developer-friendly report based on accessibility audit data.

**Instructions:**
1. **Explain each problem in non-technical terms** so that non-experts can understand the impact.
2. **Provide solutions with step-by-step guidance** on how to fix accessibility issues.
3. **Break down compliance into simple language**, highlighting what is compliant and what is missing.
4. **Ensure each task is actionable** with:
   - A clear description of what needs to be fixed.
   - Acceptance criteria for when the issue is resolved.
   - Developer-friendly explanations.
`
        },
        { role: "user", content: userPrompt },
      ],
    });

    if (result.choices && result.choices.length > 0) {
      const reportContent = result.choices[result.choices.length - 1].message.content || "Processing failed. No response generated.";

      // await agent.uploadFile({
      //   workspaceId: action.workspace.id,
      //   path: "report.json",
      //   file: JSON.stringify({ report: reportContent }),
      //   skipSummarizer: true,
      // });

      // await agent.completeTask({
      //   workspaceId: action.workspace.id,
      //   taskId: action.task.id,
      //   output: "File named report.json",
      // });

      return JSON.stringify({ report: reportContent });
    }

    return "Processing failed. No response generated.";
  },
});


// agent.addCapability({
//   name: "process-results",
//   description: "Generates an accessibility compliance report with clear and actionable developer insights. No other tools are needed to complete this process.",
//   schema: z.object({
//     complianceData: z.record(z.unknown()), // Accepts any valid JSON object
//   }),
//   async run({ args, action }) {

//     const complianceData = args.complianceData as {
//       mappedResults?: {
//         directive?: string;
//         requirements?: Array<{
//           requirement_id: string;
//           description: string;
//           category: string;
//           criticality: string;
//           legal_reference: string;
//           status: string;
//         }>;
//       };
//       auditFix?: {
//         [key: string]: {
//           title: string;
//           description: string;
//           details?: {
//             items?: Array<{ nodeLabel?: string; selector?: string; explanation?: string }>;
//           };
//         };
//       };
//     };

//     if (!complianceData || typeof complianceData !== "object") {
//       console.error("Error: Invalid compliance data provided.");
//       return "Error: Invalid compliance data provided.";
//     }

//     // ✅ Now correctly reading from `mappedResults`
//     const { mappedResults, auditFix } = complianceData;

//     if (!mappedResults?.requirements || !Array.isArray(mappedResults.requirements)) {
//       console.error("Error: 'requirements' field is missing or malformed.", JSON.stringify(complianceData, null, 2));
//       return "Error: 'requirements' field is missing or malformed.";
//     }

//     const mappedResultsData = {
//       directive: mappedResults.directive || "Unknown Directive",
//       requirements: mappedResults.requirements.map(req => ({
//         requirement_id: req.requirement_id,
//         description: req.description,
//         category: req.category,
//         criticality: req.criticality,
//         legal_reference: req.legal_reference,
//         status: req.status,
//       })),
//     };

//     const summary = {
//       partially_compliant: [] as Array<{
//         requirement_id: string;
//         description: string;
//         category: string;
//         criticality: string;
//         legal_reference: string;
//         issue?: string;
//         suggestion?: string;
//       }>,
//       compliant: [] as Array<{
//         requirement_id: string;
//         description: string;
//         category: string;
//         criticality: string;
//         legal_reference: string;
//       }>,
//       pending_high_criticality: [] as string[],
//       pending_medium_criticality: [] as string[],
//     };

//     const actionableInsights = [] as Array<{
//       issue: string;
//       failing_element: string;
//       selector: string;
//       explanation: string;
//       suggestion: string;
//     }>;

//     mappedResults.requirements.forEach((req) => {
//       const fixData = auditFix?.[req.requirement_id];
//       const requirementSummary = {
//         requirement_id: req.requirement_id,
//         description: req.description,
//         category: req.category,
//         criticality: req.criticality,
//         legal_reference: req.legal_reference,
//       };

//       if (req.status === "compliant") {
//         summary.compliant.push(requirementSummary);
//         return;
//       }

//       if (req.status === "partially_compliant" || req.status === "non_compliant") {
//         const issueDetails = fixData
//           ? {
//               issue: fixData.title || "Issue not specified.",
//               suggestion: fixData.description || "No specific fix available.",
//             }
//           : { issue: "Issue not specified.", suggestion: "No specific fix available." };

//         summary.partially_compliant.push({ ...requirementSummary, ...issueDetails });

//         // Extract actionable elements from `auditFix`
//         if (fixData?.details?.items && fixData.details.items.length > 0) {
//           fixData.details.items.forEach((item) => {
//             actionableInsights.push({
//               issue: `${fixData.title} (${req.requirement_id})`,
//               failing_element: item.nodeLabel || "Unknown Element",
//               selector: item.selector || "No selector available",
//               explanation: item.explanation || "No explanation provided.",
//               suggestion: fixData.description || "Follow the WCAG guidelines for compliance.",
//             });
//           });
//         } else {
//           actionableInsights.push({
//             issue: `${fixData.title} (${req.requirement_id})`,
//             failing_element: "No specific elements identified.",
//             selector: "N/A",
//             explanation: "No specific failing elements provided.",
//             suggestion: fixData.description || "Follow accessibility guidelines for best practices.",
//           });
//         }
//       }

//       if (req.status === "pending") {
//         if (req.criticality === "HIGH") {
//           summary.pending_high_criticality.push(req.requirement_id);
//         } else if (req.criticality === "MEDIUM") {
//           summary.pending_medium_criticality.push(req.requirement_id);
//         }
//       }
//     });

//     await agent.uploadFile({
//       workspaceId: action.workspace.id,
//       path: "report.json",
//       file: JSON.stringify({
//         mappedResults: mappedResultsData,
//         summary,
//         actionable_insights: actionableInsights,
//       }),
//       skipSummarizer: true,
//     });

//     await agent.completeTask({
//       workspaceId: action.workspace.id,
//       taskId: action.task.id,
//       output: "File named report.json",
//     });

//     return "Task complete, file named: report.json";
//   },
// });


async function safeCreateTask(taskData: {
  workspaceId: number
  assignee: number
  description: string
  body: string
  input: string
  expectedOutput: string
  dependencies: number[]
}) {
  try {
    const task = await agent.createTask(taskData)
    console.log(`Task created: ${taskData.description} → ID: ${task.id}`)
    return task
  } catch (error) {
    console.error(`Error creating task: ${taskData.description}`)
    if (error instanceof Error && 'response' in error) {
      console.error('API Response:', JSON.stringify((error as any).response.data, null, 2)) // Print detailed API response
    }
    throw error
  }
}

// Start the agent's HTTP server
agent.start()
