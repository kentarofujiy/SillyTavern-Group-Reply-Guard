// @ts-nocheck
export const GROUP_REPLY_GUARD_POST_GUARD_EVENT = 'group_reply_guard:post_guard';

export function createPostGuardEventPayload({
    messageId,
    source,
    expectedSpeaker,
    finalText,
    changed = false,
    issues = [],
    llmAnalysisUsed = false,
    rewriteApplied = false,
    reroutedSegments = [],
    rerouteDispatched = false,
    processedAt,
}) {
    return {
        messageId: Number(messageId),
        source: String(source ?? 'auto'),
        expectedSpeaker: String(expectedSpeaker ?? ''),
        finalText: String(finalText ?? ''),
        changed: Boolean(changed),
        issues: Array.from(issues ?? [], issue => String(issue)),
        llmAnalysisUsed: Boolean(llmAnalysisUsed),
        rewriteApplied: Boolean(rewriteApplied),
        reroutedSegments: Array.from(reroutedSegments ?? [], segment => ({
            speaker: String(segment?.speaker ?? ''),
            text: String(segment?.text ?? ''),
        })),
        rerouteDispatched: Boolean(rerouteDispatched),
        processedAt: Number(processedAt) || Date.now(),
    };
}