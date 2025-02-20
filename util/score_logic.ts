import fs from 'fs';

type EAARequirement = {
    requirement_id: string;
    description: string;
    category: string;
    criticality: string;
    legal_reference: string;
    status: string;
    exemptible: boolean;
};

type EAAGuidelines = {
    directive: string;
    requirements: EAARequirement[];
};

type LighthouseAudit = {
    id: string;
    title: string;
    description: string;
    score: number | null;
    scoreDisplayMode: string;
    details?: any; // Optional additional data like tables, items, or debugging information
};


const lighthouseToEAAMapping: Record<string, string[]> = {
    "color-contrast": ["A1.1"],
    "image-alt": ["A1.1"],
    "video-caption": ["A1.1"],
    "object-alt": ["A1.1"],
    "aria-allowed-attr": ["A1.1"],
    "meta-viewport": ["A1.2"],
    "target-size": ["A1.2"],
    "focus-traps": ["A1.2"],
    "interactive-element-affordance": ["A1.2"],
    "link-name": ["A6.1"],
    "button-name": ["A6.1"],
    "form-field-multiple-labels": ["A6.1"],
    "label": ["A6.1"],
    "html-has-lang": ["A6.1"],
    "aria-required-attr": ["A1.1"],
    "aria-valid-attr-value": ["A1.1"],
    "aria-roles": ["A1.1"],
    "duplicate-id-aria": ["A1.1"]
};

export function mapLighthouseToEAA(lighthouseJson: Record<string, LighthouseAudit>, eaaGuidelines: EAAGuidelines): { mappedResults: EAAGuidelines; auditFix: Record<string, LighthouseAudit> } {
    const mappedResults: EAAGuidelines = JSON.parse(JSON.stringify(eaaGuidelines));

    const statusCounts: Record<string, { compliant: number; non_compliant: number; exempted: number }> = {};

    const auditFix: Record<string, LighthouseAudit> = {};

    // Iterate through Lighthouse audits
    Object.entries(lighthouseJson).forEach(([auditId, audit]) => {
        const eaaIds = lighthouseToEAAMapping[auditId];
        if (eaaIds) {
            eaaIds.forEach(eaaId => {
                if (!statusCounts[eaaId]) {
                    statusCounts[eaaId] = { compliant: 0, non_compliant: 0, exempted: 0 };
                }

                if (audit.score === 1) {
                    statusCounts[eaaId].compliant++;
                } else if (audit.score === 0) {
                    statusCounts[eaaId].non_compliant++;
                    auditFix[eaaId] = audit;

                } else {
                    statusCounts[eaaId].exempted++;
                }
            });
        }
    });

    // Determine final status
    mappedResults.requirements.forEach(requirement => {
        const counts = statusCounts[requirement.requirement_id];
        if (counts) {
            if (counts.non_compliant > 0 && counts.compliant > 0) {
                requirement.status = "partially_compliant";
            } else if (counts.non_compliant > 0) {
                requirement.status = "non_compliant";
            } else if (counts.compliant > 0) {
                requirement.status = "compliant";
            } else {
                requirement.status = "exempted";
            }
        }
    });

    return { mappedResults, auditFix };
}
