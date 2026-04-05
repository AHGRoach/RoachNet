import Foundation

public struct RoachBrainMemory: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public var title: String
    public var summary: String
    public var body: String
    public var source: String
    public var tags: [String]
    public var pinned: Bool
    public var createdAt: String
    public var lastAccessedAt: String

    public init(
        id: String,
        title: String,
        summary: String,
        body: String,
        source: String,
        tags: [String],
        pinned: Bool,
        createdAt: String,
        lastAccessedAt: String
    ) {
        self.id = id
        self.title = title
        self.summary = summary
        self.body = body
        self.source = source
        self.tags = tags
        self.pinned = pinned
        self.createdAt = createdAt
        self.lastAccessedAt = lastAccessedAt
    }
}

public struct RoachBrainMatch: Identifiable, Hashable, Sendable {
    public let id: String
    public let memory: RoachBrainMemory
    public let score: Double
    public let matchedTags: [String]

    public init(memory: RoachBrainMemory, score: Double, matchedTags: [String]) {
        self.id = memory.id
        self.memory = memory
        self.score = score
        self.matchedTags = matchedTags
    }
}

public enum RoachBrainStore {
    private static let maxMemories = 180

    public static func load(storagePath: String) -> [RoachBrainMemory] {
        let url = RoachNetDeveloperPaths.roachBrainCatalogURL(storagePath: storagePath)
        guard
            let data = try? Data(contentsOf: url),
            let decoded = try? JSONDecoder().decode([RoachBrainMemory].self, from: data)
        else {
            return []
        }

        return decoded.sorted(by: sortNewestFirst)
    }

    public static func save(_ memories: [RoachBrainMemory], storagePath: String) throws {
        try RoachNetDeveloperPaths.ensureWorkspaceDirectories(storagePath: storagePath)
        let trimmed = trim(memories.sorted(by: sortNewestFirst))
        let data = try JSONEncoder.pretty.encode(trimmed)
        try data.write(to: RoachNetDeveloperPaths.roachBrainCatalogURL(storagePath: storagePath), options: [.atomic])
    }

    @discardableResult
    public static func capture(
        storagePath: String,
        title: String,
        body: String,
        source: String,
        tags: [String] = [],
        pinned: Bool = false
    ) throws -> RoachBrainMemory {
        let normalizedTitle = cleaned(title)
        let normalizedBody = cleaned(body)
        guard !normalizedTitle.isEmpty, !normalizedBody.isEmpty else {
            throw NSError(domain: "RoachBrain", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "RoachBrain needs both a title and body before it can store a memory."
            ])
        }

        let timestamp = timestampString(from: Date())
        var memories = load(storagePath: storagePath)

        if let index = memories.firstIndex(where: { existing in
            existing.title.caseInsensitiveCompare(normalizedTitle) == .orderedSame
            && cleaned(existing.body) == normalizedBody
        }) {
            memories[index].summary = summarize(body: normalizedBody)
            memories[index].source = source
            memories[index].tags = mergedTags(memories[index].tags + tags)
            memories[index].pinned = memories[index].pinned || pinned
            memories[index].lastAccessedAt = timestamp
            try save(memories, storagePath: storagePath)
            return memories[index]
        }

        let memory = RoachBrainMemory(
            id: UUID().uuidString,
            title: normalizedTitle,
            summary: summarize(body: normalizedBody),
            body: normalizedBody,
            source: cleaned(source).isEmpty ? "RoachNet" : cleaned(source),
            tags: mergedTags(tags),
            pinned: pinned,
            createdAt: timestamp,
            lastAccessedAt: timestamp
        )

        memories.insert(memory, at: 0)
        try save(memories, storagePath: storagePath)
        return memory
    }

    public static func search(
        storagePath: String,
        query: String,
        tags: [String] = [],
        limit: Int = 5
    ) -> [RoachBrainMatch] {
        search(load(storagePath: storagePath), query: query, tags: tags, limit: limit)
    }

    public static func search(
        _ memories: [RoachBrainMemory],
        query: String,
        tags: [String] = [],
        limit: Int = 5
    ) -> [RoachBrainMatch] {
        let normalizedQuery = cleaned(query)
        let queryTokens = tokenSet(from: normalizedQuery)
        let requestedTags = Set(mergedTags(tags))

        let matches = memories.compactMap { memory -> RoachBrainMatch? in
            let title = memory.title.lowercased()
            let summary = memory.summary.lowercased()
            let body = memory.body.lowercased()
            let memoryTagSet = Set(memory.tags.map { $0.lowercased() })
            let matchedTags = Array(requestedTags.intersection(memoryTagSet)).sorted()

            let titleTokens = tokenSet(from: title)
            let summaryTokens = tokenSet(from: summary)
            let bodyTokens = tokenSet(from: body)

            var score = 0.0

            if normalizedQuery.isEmpty {
                score += memory.pinned ? 30 : 10
            } else {
                if title.contains(normalizedQuery) { score += 110 }
                if summary.contains(normalizedQuery) { score += 60 }
                if body.contains(normalizedQuery) { score += 40 }
            }

            let titleHits = Double(queryTokens.intersection(titleTokens).count)
            let summaryHits = Double(queryTokens.intersection(summaryTokens).count)
            let bodyHits = Double(queryTokens.intersection(bodyTokens).count)

            score += titleHits * 30
            score += summaryHits * 14
            score += bodyHits * 8
            score += Double(matchedTags.count) * 18

            if memory.pinned { score += 24 }
            score += recencyBonus(for: memory)

            return score > 0 ? RoachBrainMatch(memory: memory, score: score, matchedTags: matchedTags) : nil
        }

        return Array(matches.sorted { lhs, rhs in
            if lhs.score == rhs.score {
                return sortNewestFirst(lhs.memory, rhs.memory)
            }
            return lhs.score > rhs.score
        }.prefix(limit))
    }

    public static func markAccessed(memoryIDs: [String], storagePath: String) throws {
        guard !memoryIDs.isEmpty else { return }
        var memories = load(storagePath: storagePath)
        let timestamp = timestampString(from: Date())
        let idSet = Set(memoryIDs)

        var changed = false
        for index in memories.indices where idSet.contains(memories[index].id) {
            memories[index].lastAccessedAt = timestamp
            changed = true
        }

        if changed {
            try save(memories, storagePath: storagePath)
        }
    }

    public static func contextBlock(for matches: [RoachBrainMatch]) -> String {
        guard !matches.isEmpty else { return "" }

        let lines = matches.enumerated().map { index, match in
            let tags = match.memory.tags.isEmpty ? "" : " [tags: \(match.memory.tags.joined(separator: ", "))]"
            return """
            \(index + 1). \(match.memory.title) — \(match.memory.summary)\(tags)
            Source: \(match.memory.source)
            """
        }

        return """
        RoachBrain memory context:
        \(lines.joined(separator: "\n\n"))
        """
    }

    private static func summarize(body: String) -> String {
        let firstParagraph = body
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first(where: { !$0.isEmpty }) ?? body

        let compact = firstParagraph.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        return compact.count > 140 ? String(compact.prefix(137)) + "..." : compact
    }

    private static func mergedTags(_ tags: [String]) -> [String] {
        Array(
            Set(
                tags
                    .map { cleaned($0).lowercased() }
                    .filter { !$0.isEmpty }
            )
        )
        .sorted()
    }

    private static func cleaned(_ value: String) -> String {
        value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\u{0000}", with: "")
    }

    private static func tokenSet(from value: String) -> Set<String> {
        Set(
            value
                .lowercased()
                .components(separatedBy: CharacterSet.alphanumerics.inverted)
                .filter { $0.count >= 2 }
        )
    }

    private static func recencyBonus(for memory: RoachBrainMemory) -> Double {
        guard let date = parsedDate(from: memory.lastAccessedAt) ?? parsedDate(from: memory.createdAt) else {
            return 0
        }

        let age = Date().timeIntervalSince(date)
        switch age {
        case ..<86_400:
            return 22
        case ..<604_800:
            return 16
        case ..<2_592_000:
            return 8
        default:
            return 2
        }
    }

    private static func trim(_ memories: [RoachBrainMemory]) -> [RoachBrainMemory] {
        guard memories.count > maxMemories else { return memories }

        let pinned = memories.filter(\.pinned)
        let unpinned = memories.filter { !$0.pinned }
        let remainingSlots = max(maxMemories - pinned.count, 0)
        return Array((pinned + unpinned.prefix(remainingSlots)).sorted(by: sortNewestFirst))
    }

    private static func sortNewestFirst(_ lhs: RoachBrainMemory, _ rhs: RoachBrainMemory) -> Bool {
        let lhsDate = parsedDate(from: lhs.lastAccessedAt) ?? parsedDate(from: lhs.createdAt) ?? .distantPast
        let rhsDate = parsedDate(from: rhs.lastAccessedAt) ?? parsedDate(from: rhs.createdAt) ?? .distantPast
        return lhsDate > rhsDate
    }

    private static func timestampString(from date: Date) -> String {
        date.formatted(.iso8601.year().month().day().dateSeparator(.dash).time(includingFractionalSeconds: true))
    }

    private static func parsedDate(from value: String) -> Date? {
        try? Date(value, strategy: .iso8601)
    }
}
