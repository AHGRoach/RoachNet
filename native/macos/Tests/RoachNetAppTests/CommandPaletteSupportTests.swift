import XCTest
@testable import RoachNetApp

final class CommandPaletteSupportTests: XCTestCase {
    func testCommandPaletteSearchUsesAliasesAndLooseCharacterOrder() {
        let entries = [
            CommandPaletteEntry(
                id: "roachclaw-anywhere",
                section: "RoachClaw",
                title: "Open RoachClaw Anywhere",
                detail: "Float chat and context over the current surface.",
                systemImage: "sparkles",
                target: .pane(.roachClaw),
                keywords: ["assistant", "chat"],
                aliases: ["ai overlay", "ask ai"]
            ),
            CommandPaletteEntry(
                id: "runtime",
                section: "Runtime",
                title: "Refresh Runtime",
                detail: "Recheck local services.",
                systemImage: "arrow.clockwise",
                target: .refreshRuntime
            ),
        ]

        XCTAssertEqual(filteredCommandPaletteEntries(from: entries, query: "ai overlay").first?.id, "roachclaw-anywhere")
        XCTAssertEqual(filteredCommandPaletteEntries(from: entries, query: "rchclw").first?.id, "roachclaw-anywhere")
    }

    func testCommandPaletteVisibleEntriesPromotesRecentsWithoutDuplicates() {
        let dev = CommandPaletteEntry(
            id: "pane-dev",
            section: "Navigate",
            title: "Dev",
            detail: "Editor, terminal, assist.",
            systemImage: "terminal.fill",
            target: .pane(.dev)
        )
        let vault = CommandPaletteEntry(
            id: "pane-vault",
            section: "Navigate",
            title: "Vault",
            detail: "Books, notes, metadata.",
            systemImage: "books.vertical.fill",
            target: .pane(.knowledge)
        )

        let visible = commandPaletteVisibleEntries(
            entries: [dev, vault],
            recentEntries: [vault],
            query: ""
        )

        XCTAssertEqual(visible.map(\.id), ["pane-vault", "pane-dev"])
    }

    func testCommandPaletteTokenizesShortcutStyleQueries() {
        XCTAssertEqual(commandPaletteTokens(from: "open-runtime_log"), ["open", "runtime", "log"])
    }
}
