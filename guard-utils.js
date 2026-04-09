// @ts-nocheck
export const QUALITY_MARKERS = [
    /\blittle did (?:he|she|they|you) know\b/i,
    /\bunbeknownst to\b/i,
    /\bmeanwhile,? unbeknownst\b/i,
    /\beveryone (?:knew|felt|realized|noticed)\b/i,
    /\bas an ai\b/i,
    /\booc\b/i,
];

export const META_RESPONSE_MARKERS = [
    /^the user wants me to\b/i,
    /^the detected issue\b/i,
    /^looking at the candidate reply\b/i,
    /^let me examine\b/i,
    /^it seems consistent with\b/i,
    /^based on the context\b/i,
    /\bcandidate reply\b/i,
    /\bdetected issue(?:s)?\b/i,
    /\bexpected speaker\b/i,
    /\brecent context\b/i,
    /\bparticipants:\s*$/im,
];

export const ATTRIBUTION_REFERENCE_MARKERS = [
    /\b(?:you|your)\b/i,
    /\b(?:he|she|they)\s+said\b/i,
    /\b(?:turning|looking|glancing|speaking)\s+to\b/i,
    /["“”].+["“”]/,
];

function uniqueStrings(values) {
    return Array.from(new Set(values.filter(Boolean).map(value => String(value).trim()).filter(Boolean)));
}

export function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function truncateText(text, maxLength = 320) {
    const source = String(text ?? '').trim();
    if (source.length <= maxLength) {
        return source;
    }

    return `${source.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

export function normalizeReplyText(text) {
    const lines = String(text ?? '')
        .replace(/\r/g, '')
        .split('\n')
        .map(line => line.replace(/\s+$/g, ''));

    const normalized = [];
    let blankRun = 0;

    for (const line of lines) {
        if (!line.trim()) {
            blankRun++;
            if (blankRun <= 1) {
                normalized.push('');
            }
            continue;
        }

        blankRun = 0;
        normalized.push(line);
    }

    return normalized.join('\n').trim();
}

function buildSpeakerMatchers(names) {
    return uniqueStrings(names)
        .sort((left, right) => right.length - left.length)
        .map(name => ({
            name,
            explicit: new RegExp(`^\\s*[>*_~\"'\\[]*${escapeRegExp(name)}\\s*(?:[:\\-\\u2013\\u2014]|[>])\\s*`, 'i'),
            action: new RegExp(`^\\s*[*_~\"']${escapeRegExp(name)}\\b\\s+`, 'i'),
        }));
}

export function detectExplicitSpeaker(line, names) {
    const source = String(line ?? '');
    for (const matcher of buildSpeakerMatchers(names)) {
        if (matcher.explicit.test(source) || matcher.action.test(source)) {
            return matcher.name;
        }
    }

    return null;
}

export function stripSpeakerPrefix(line, speakerName) {
    const source = String(line ?? '');
    const name = escapeRegExp(speakerName);

    const explicit = new RegExp(`^(\\s*[>*_~\"'\\[]*)${name}\\s*(?:[:\\-\\u2013\\u2014]|[>])\\s*`, 'i');
    if (explicit.test(source)) {
        return source.replace(explicit, '$1').trim();
    }

    const action = new RegExp(`^(\\s*[*_~\"'])${name}\\b\\s+`, 'i');
    if (action.test(source)) {
        return source.replace(action, '$1').trim();
    }

    return source.trim();
}

function pushReroutedLine(reroutedSegments, speaker, line) {
    const text = String(line ?? '').trim();
    if (!text) {
        return;
    }

    const lastSegment = reroutedSegments.at(-1);
    if (lastSegment && lastSegment.speaker === speaker) {
        lastSegment.text = normalizeReplyText(`${lastSegment.text}\n${text}`);
        return;
    }

    reroutedSegments.push({ speaker, text });
}

export function detectQualityIssues(text) {
    const issues = [];
    const normalized = normalizeReplyText(text);

    if (!normalized) {
        issues.push('empty_after_cleanup');
        return issues;
    }

    const meaningfulLines = normalized
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
    const seenLines = new Set();

    for (const line of meaningfulLines) {
        const key = line.toLowerCase();
        if (seenLines.has(key)) {
            issues.push('repetition_detected');
            break;
        }
        seenLines.add(key);
    }

    if (/(\b\w+\b)(?:\s+\1){3,}/i.test(normalized)) {
        issues.push('nonsensical_repetition');
    }

    if (META_RESPONSE_MARKERS.some(pattern => pattern.test(normalized))) {
        issues.push('meta_rewrite_response');
    }

    if (QUALITY_MARKERS.some(pattern => pattern.test(normalized))) {
        issues.push('omniscient_or_meta_content');
    }

    return uniqueStrings(issues);
}

export function detectAttributionSignals({ text, expectedName, userNames = [], otherNames = [] }) {
    const normalized = normalizeReplyText(text);
    if (!normalized) {
        return [];
    }

    const issues = [];
    const userList = uniqueStrings(userNames);
    const otherList = uniqueStrings(otherNames);
    const allNames = uniqueStrings([expectedName, ...userList, ...otherList]);
    const userMatchers = userList.map(name => ({ name, pattern: new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i') }));
    const otherMatchers = otherList.map(name => ({ name, pattern: new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i') }));

    let foundReference = false;

    for (const line of normalized.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }

        const explicitSpeaker = detectExplicitSpeaker(trimmed, allNames);
        if (explicitSpeaker) {
            continue;
        }

        const hasUserReference = userMatchers.some(({ pattern }) => pattern.test(trimmed));
        const hasOtherReference = otherMatchers.some(({ pattern }) => pattern.test(trimmed));

        if (hasUserReference) {
            issues.push('ambiguous_user_reference');
            foundReference = true;
        }

        if (hasOtherReference) {
            issues.push('ambiguous_other_character_reference');
            foundReference = true;
        }
    }

    if (foundReference || ATTRIBUTION_REFERENCE_MARKERS.some(pattern => pattern.test(normalized))) {
        if (issues.length > 0) {
            issues.push('ambiguous_multi_character_prose');
        }
    }

    return uniqueStrings(issues);
}

export function sanitizeGeneratedReply({ text, expectedName, userNames = [], otherNames = [] }) {
    const source = normalizeReplyText(text);
    const issues = [];
    const reroutedSegments = [];
    const keepLines = [];
    const names = uniqueStrings([expectedName, ...userNames, ...otherNames]);
    const userSet = new Set(uniqueStrings(userNames).map(name => name.toLowerCase()));
    const otherSet = new Set(uniqueStrings(otherNames).map(name => name.toLowerCase()));

    let activeSpeaker = expectedName;
    let truncatedForUser = false;

    for (const rawLine of source.split('\n')) {
        if (!rawLine.trim()) {
            if (activeSpeaker === expectedName && keepLines.length > 0 && keepLines.at(-1) !== '') {
                keepLines.push('');
            }
            continue;
        }

        const detectedSpeaker = detectExplicitSpeaker(rawLine, names);

        if (detectedSpeaker) {
            activeSpeaker = detectedSpeaker;
            const lowered = detectedSpeaker.toLowerCase();
            const stripped = stripSpeakerPrefix(rawLine, detectedSpeaker);

            if (userSet.has(lowered)) {
                issues.push('user_content_truncated');
                truncatedForUser = true;
                break;
            }

            if (otherSet.has(lowered)) {
                issues.push('other_character_removed');
                pushReroutedLine(reroutedSegments, detectedSpeaker, stripped);
                continue;
            }

            keepLines.push(stripped || rawLine.trim());
            continue;
        }

        if (activeSpeaker && otherSet.has(activeSpeaker.toLowerCase())) {
            issues.push('other_character_removed');
            pushReroutedLine(reroutedSegments, activeSpeaker, rawLine);
            continue;
        }

        keepLines.push(rawLine.trimEnd());
    }

    const cleanText = normalizeReplyText(keepLines.join('\n'));

    if (truncatedForUser && !cleanText) {
        issues.push('empty_after_cleanup');
    }

    issues.push(...detectQualityIssues(cleanText));

    return {
        cleanText,
        reroutedSegments,
        issues: uniqueStrings(issues),
        modified: cleanText !== source || reroutedSegments.length > 0,
    };
}