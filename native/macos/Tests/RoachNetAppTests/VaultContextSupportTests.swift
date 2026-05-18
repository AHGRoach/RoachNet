import XCTest
@testable import RoachNetApp

final class VaultContextSupportTests: XCTestCase {
    func testPreviewKindRecognizesVaultAssetTypes() {
        XCTAssertEqual(VaultPreviewKind.resolve(for: URL(fileURLWithPath: "/tmp/note.md")), .markdown)
        XCTAssertEqual(VaultPreviewKind.resolve(for: URL(fileURLWithPath: "/tmp/log.txt")), .text)
        XCTAssertEqual(VaultPreviewKind.resolve(for: URL(fileURLWithPath: "/tmp/config.json")), .text)
        XCTAssertEqual(VaultPreviewKind.resolve(for: URL(fileURLWithPath: "/tmp/cover.png")), .image)
        XCTAssertEqual(VaultPreviewKind.resolve(for: URL(fileURLWithPath: "/tmp/track.flac")), .audio)
        XCTAssertEqual(VaultPreviewKind.resolve(for: URL(fileURLWithPath: "/tmp/movie.mp4")), .video)
        XCTAssertEqual(VaultPreviewKind.resolve(for: URL(fileURLWithPath: "/tmp/book.pdf")), .pdf)
        XCTAssertEqual(VaultPreviewKind.resolve(for: URL(fileURLWithPath: "/tmp/book.epub")), .book)
        XCTAssertEqual(VaultPreviewKind.resolve(for: URL(fileURLWithPath: "/tmp/book.azw3")), .book)
        XCTAssertEqual(VaultPreviewKind.resolve(for: URL(fileURLWithPath: "/tmp/comic.cbz")), .book)
        XCTAssertEqual(VaultPreviewKind.resolve(for: URL(fileURLWithPath: "/tmp/source.zip")), .archive)
        XCTAssertEqual(VaultPreviewKind.resolve(for: URL(fileURLWithPath: "/tmp/bundle.7z")), .archive)
        XCTAssertEqual(VaultPreviewKind.resolve(for: URL(fileURLWithPath: "/tmp/folder", isDirectory: true)), .folder)
        XCTAssertEqual(VaultPreviewKind.resolve(for: URL(fileURLWithPath: "/tmp/archive.bin")), .generic)
    }

    func testTextExcerptLoadsMarkdownAndNormalizesWhitespace() throws {
        let directory = try makeTemporaryDirectory()
        let fileURL = directory.appendingPathComponent("Context.md")
        try """
        # Heading

          First line with context.

        Second line.
        """.write(to: fileURL, atomically: true, encoding: .utf8)

        let excerpt = RoachClawContextSupport.textExcerpt(for: fileURL, maxCharacters: 160)

        XCTAssertEqual(excerpt, "# Heading\nFirst line with context.\nSecond line.")
    }

    func testNormalizedExcerptTruncatesToBudget() {
        let source = String(repeating: "vault-context ", count: 80)

        let excerpt = RoachClawContextSupport.normalizedExcerpt(source, maxCharacters: 64)

        XCTAssertNotNil(excerpt)
        XCTAssertTrue(excerpt?.count == 65)
        XCTAssertTrue(excerpt?.hasSuffix("…") == true)
    }

    func testVaultDropImportDestinationSanitizesAndAvoidsCollisions() throws {
        let directory = try makeTemporaryDirectory()
        let source = URL(fileURLWithPath: "/tmp/Bad:Name.pdf")
        let firstDestination = VaultDropImportSupport.destinationURL(for: source, in: directory)
        try Data("existing".utf8).write(to: firstDestination)
        let secondDestination = VaultDropImportSupport.destinationURL(for: source, in: directory)

        XCTAssertEqual(firstDestination.lastPathComponent, "Bad-Name.pdf")
        XCTAssertEqual(secondDestination.lastPathComponent, "Bad-Name 2.pdf")
    }

    func testVaultDropImportDetectsAlreadyVaultedFiles() throws {
        let directory = try makeTemporaryDirectory()
        let vaultRoot = directory.appendingPathComponent("Vault", isDirectory: true)
        let source = vaultRoot.appendingPathComponent("note.md")

        XCTAssertTrue(VaultDropImportSupport.isInsideVault(source, vaultRootURL: vaultRoot))
        XCTAssertFalse(VaultDropImportSupport.isInsideVault(URL(fileURLWithPath: "/tmp/note.md"), vaultRootURL: vaultRoot))
    }

    @MainActor
    func testDeveloperTerminalUsesPinnedWorkingDirectoryWhenSet() {
        let model = DevWorkspaceModel()
        model.projectsRootPath = "/tmp/workspace"
        model.terminalWorkingDirectoryOverride = "/tmp/workspace/project-a"

        XCTAssertEqual(model.currentWorkingDirectory(), "/tmp/workspace/project-a")
    }

    private func makeTemporaryDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock {
            try? FileManager.default.removeItem(at: directory)
        }
        return directory
    }
}
