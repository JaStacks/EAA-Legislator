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
        dependencies: compareAudit.id ? [compareAudit.id] : []
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
    await agent.uploadFile({
      workspaceId: action.workspace.id,
      path: 'regulations.json',
      file: JSON.stringify(regulation),
      skipSummarizer: true
    })
    await agent.completeTask({
      workspaceId: action.workspace.id,
      taskId: action.task.id,
      output: 'File named regulations.json'
    })
    return 'Task complete'
  }
})

agent.addCapability({
  name: 'run-comparison',
  description: `Run a comparison check between the audit's output and the EAA compliance regulations by retrieving files from the workspace. No other tools are needed to complete this process.`,
  schema: z.object({}),
  async run({ args, action }): Promise<string> {
    try {
      // Validate workspace ID
      const workspaceId = action.workspace.id
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

      await agent.uploadFile({
        workspaceId: action.workspace.id,
        path: 'compliance.json',
        file: JSON.stringify({ mappedResults, auditFix }),
        skipSummarizer: true
      })
      await agent.completeTask({
        workspaceId: action.workspace.id,
        taskId: action.task.id,
        output: 'File named compliance.json'
      })
      return 'Task complete, compliance.json uploaded'
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
    console.log("Final score", finalScore);

    await agent.uploadFile({
      workspaceId: action.workspace.id,
      path: 'score.json',
      file: JSON.stringify({ finalScore: Math.round(finalScore) }),
      skipSummarizer: true
    })
    await agent.completeTask({
      workspaceId: action.workspace.id,
      taskId: action.task.id,
      output: 'File named score.json'
    })
    return 'Task complete, file named: score.json'
  }
})


const complianceDataSchema = z.object({
  mappedResults: z.object({
    directive: z.string().optional(),
    requirements: z.array(
      z.object({
        requirement_id: z.string(),
        description: z.string(),
        category: z.string(),
        criticality: z.string(),
        legal_reference: z.string(),
        status: z.enum(["compliant", "partially_compliant", "non_compliant", "pending"]),
        exemptible: z.boolean().optional(),
      })
    ),
  }),
  auditFix: z.record(
    z.string(),
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      score: z.number().optional(),
      scoreDisplayMode: z.string().optional(),
      details: z
        .object({
          type: z.string(),
          headings: z.array(
            z.object({
              key: z.string(),
              valueType: z.string(),
              subItemsHeading: z
                .object({
                  key: z.string(),
                  valueType: z.string(),
                })
                .optional(),
              label: z.string(),
            })
          ),
          items: z.array(
            z.object({
              node: z.object({
                type: z.string(),
                lhId: z.string(),
                path: z.string(),
                selector: z.string(),
                boundingRect: z.object({
                  top: z.number(),
                  bottom: z.number(),
                  left: z.number(),
                  right: z.number(),
                  width: z.number(),
                  height: z.number(),
                }),
                snippet: z.string(),
                nodeLabel: z.string(),
                explanation: z.string(),
              }),
            })
          ),
          debugData: z.object({
            type: z.string(),
            impact: z.string(),
            tags: z.array(z.string()),
          }),
        })
        .optional(),
    })
  ),
});

agent.addCapability({
  name: "process-results",
  description: "Generates an accessibility compliance report with clear and actionable developer insights. No other tools are needed to complete this process.",
  schema: z.object({
    complianceData: complianceDataSchema, // Enforce structured validation
  }),
  async run({ args, action }) {
    const complianceData = args.complianceData;

    if (!complianceData || typeof complianceData !== "object") {
      console.error("Error: Invalid compliance data provided.");
      return "Error: Invalid compliance data provided.";
    }

    try {
      complianceDataSchema.parse(complianceData);
    } catch (error) {
      console.error("Schema validation failed:", error.errors);
      return "Error: Compliance data does not match the expected schema.";
    }

    const { mappedResults, auditFix } = complianceData;

    if (!mappedResults?.requirements || !Array.isArray(mappedResults.requirements)) {
      console.error("Error: 'requirements' field is missing or malformed.");
      return "Error: 'requirements' field is missing or malformed.";
    }

    const summary = {
      partially_compliant: [],
      compliant: [],
      pending_high_criticality: [],
      pending_medium_criticality: [],
    };

    const actionableInsights = [];

    mappedResults.requirements.forEach((req) => {
      const fixData = auditFix?.[req.requirement_id];
      const requirementSummary = {
        requirement_id: req.requirement_id,
        description: req.description,
        category: req.category,
        criticality: req.criticality,
        legal_reference: req.legal_reference,
      };

      if (req.status === "compliant") {
        summary.compliant.push(requirementSummary);
        return;
      }

      if (req.status === "partially_compliant" || req.status === "non_compliant") {
        const issueDetails = fixData
          ? {
              issue: fixData.title || "Issue not specified.",
              suggestion: fixData.description || "No specific fix available.",
            }
          : { issue: "Issue not specified.", suggestion: "No specific fix available." };

        summary.partially_compliant.push({ ...requirementSummary, ...issueDetails });

        if (fixData?.details?.items && fixData.details.items.length > 0) {
          fixData.details.items.forEach((item) => {
            actionableInsights.push({
              issue: `${fixData.title} (${req.requirement_id})`,
              failing_element: item.node.nodeLabel || "Unknown Element",
              selector: item.node.selector || "No selector available",
              explanation: item.node.explanation || "No explanation provided.",
              suggestion: fixData.description || "Follow the WCAG guidelines for compliance.",
            });
          });
        } else {
          actionableInsights.push({
            issue: `${fixData.title} (${req.requirement_id})`,
            failing_element: "No specific elements identified.",
            selector: "N/A",
            explanation: "No specific failing elements provided.",
            suggestion: fixData.description || "Follow accessibility guidelines for best practices.",
          });
        }
      }

      if (req.status === "pending") {
        if (req.criticality === "HIGH") {
          summary.pending_high_criticality.push(req.requirement_id);
        } else if (req.criticality === "MEDIUM") {
          summary.pending_medium_criticality.push(req.requirement_id);
        }
      }
    });

    await agent.uploadFile({
      workspaceId: action.workspace.id,
      path: "report.json",
      file: JSON.stringify({
        directive: mappedResults.directive || "Unknown Directive",
        summary,
        actionable_insights: actionableInsights,
      }),
      skipSummarizer: true,
    });

    await agent.completeTask({
      workspaceId: action.workspace.id,
      taskId: action.task.id,
      output: "File named report.json",
    });

    return "Task complete, file named: report.json";
  },
});



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
