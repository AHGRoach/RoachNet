import XCTest
@testable import RoachNetApp

final class RoachArchiveTests: XCTestCase {
    func testSearchResultDecodesFlexibleArchiveMetadata() throws {
        let json = """
        {
          "id": "aa-demo",
          "title": "Preservation Demo",
          "author": "Anna Example",
          "publication_year": "1999",
          "extension": "epub",
          "source": "aa_derived_mirror_metadata",
          "file_url": "file:///tmp/preservation-demo.epub",
          "metadata_url": "https://annas-archive.gl/md5/demo"
        }
        """
        let result = try JSONDecoder().decode(RoachArchiveSearchResult.self, from: Data(json.utf8))

        XCTAssertEqual(result.id, "aa-demo")
        XCTAssertEqual(result.title, "Preservation Demo")
        XCTAssertEqual(result.authors, ["Anna Example"])
        XCTAssertEqual(result.format, "epub")
        XCTAssertEqual(result.downloadURL, "file:///tmp/preservation-demo.epub")
    }

    func testTorrentManifestDecodesAnnaArchiveShape() throws {
        let json = """
        {
          "url": "https://annas-archive.gl/dyn/small_file/torrents/managed_by_aa/demo.torrent",
          "top_level_group_name": "managed_by_aa",
          "group_name": "aa_derived_mirror_metadata",
          "display_name": "aa_derived_mirror_metadata__demo.torrent",
          "added_to_torrents_list_at": "2026-04-06",
          "is_metadata": true,
          "btih": "0123456789abcdef",
          "magnet_link": "magnet:?xt=urn:btih:0123456789abcdef",
          "data_size": 300018193590,
          "seeders": 7,
          "leechers": 1
        }
        """
        let item = try JSONDecoder().decode(RoachArchiveTorrentItem.self, from: Data(json.utf8))

        XCTAssertTrue(item.isMetadata)
        XCTAssertEqual(item.groupName, "aa_derived_mirror_metadata")
        XCTAssertEqual(item.seeders, 7)
        XCTAssertEqual(item.id, "0123456789abcdef")
    }

    func testVaultRecordDecodesLegacyMetadataDefaults() throws {
        let json = """
        {
          "id": "22222222-2222-2222-2222-222222222222",
          "result": {
            "id": "legacy-book",
            "title": "Legacy Book",
            "authors": [],
            "source": "local"
          },
          "metadataPath": "/tmp/legacy.metadata.json",
          "importedAt": "2026-05-01T00:00:00Z",
          "status": "Metadata added"
        }
        """

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let record = try decoder.decode(RoachArchiveVaultRecord.self, from: Data(json.utf8))

        XCTAssertEqual(record.result.title, "Legacy Book")
        XCTAssertEqual(record.readingProgress, 0)
        XCTAssertNil(record.lastOpenedAt)
        XCTAssertEqual(record.notes, "")
        XCTAssertEqual(record.tags, [])
    }

    @MainActor
    func testArchiveStoreClearsStaleDevelopmentEndpoint() {
        let defaults = UserDefaults.standard
        let previousEndpoint = defaults.string(forKey: RoachArchiveStore.endpointKey)
        defer {
            if let previousEndpoint {
                defaults.set(previousEndpoint, forKey: RoachArchiveStore.endpointKey)
            } else {
                defaults.removeObject(forKey: RoachArchiveStore.endpointKey)
            }
        }

        defaults.set("http://127.0.0.1:38221", forKey: RoachArchiveStore.endpointKey)

        let store = RoachArchiveStore()

        XCTAssertEqual(store.endpointURLString, "")
        XCTAssertNil(defaults.string(forKey: RoachArchiveStore.endpointKey))
    }

    @MainActor
    func testConfigureResetsTransientMetadataPath() throws {
        let defaults = UserDefaults.standard
        let previousMetadataPath = defaults.string(forKey: RoachArchiveStore.metadataDirectoryKey)
        defer {
            if let previousMetadataPath {
                defaults.set(previousMetadataPath, forKey: RoachArchiveStore.metadataDirectoryKey)
            } else {
                defaults.removeObject(forKey: RoachArchiveStore.metadataDirectoryKey)
            }
        }

        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("RoachArchiveConfigTests-\(UUID().uuidString)", isDirectory: true)
        defer {
            try? FileManager.default.removeItem(at: root)
        }

        defaults.set(
            "/private/var/folders/demo/T/roachnet-setup-smoke-demo/installed/RoachNet/storage/RoachArchive/Metadata",
            forKey: RoachArchiveStore.metadataDirectoryKey
        )

        let store = RoachArchiveStore()
        store.configure(storagePath: root.path)

        let expectedPath = root
            .appendingPathComponent("RoachArchive", isDirectory: true)
            .appendingPathComponent("Metadata", isDirectory: true)
            .standardizedFileURL
            .path

        XCTAssertEqual(URL(fileURLWithPath: store.metadataDirectoryPath).standardizedFileURL.path, expectedPath)
        XCTAssertTrue(FileManager.default.fileExists(atPath: expectedPath))
    }

    @MainActor
    func testLocalMetadataSearchFindsBookRecords() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("RoachArchiveTests-\(UUID().uuidString)", isDirectory: true)
        let metadataRoot = root.appendingPathComponent("Metadata", isDirectory: true)
        try FileManager.default.createDirectory(at: metadataRoot, withIntermediateDirectories: true)
        defer {
            try? FileManager.default.removeItem(at: root)
        }

        let metadata = """
        {"id":"demo-1","title":"Offline Library Systems","authors":["B. Roach"],"year":2026,"format":"pdf","source":"aa_derived_mirror_metadata"}
        {"id":"demo-2","title":"Unrelated Shelf","authors":["Someone Else"],"year":2025,"format":"epub","source":"local"}
        """
        try metadata.write(to: metadataRoot.appendingPathComponent("books.jsonl"), atomically: true, encoding: .utf8)

        let store = RoachArchiveStore()
        store.configure(storagePath: root.path)
        store.endpointURLString = ""
        store.metadataDirectoryPath = metadataRoot.path
        store.query = "offline library"
        await store.search()

        XCTAssertEqual(store.results.map(\.title), ["Offline Library Systems"])
        XCTAssertNil(store.errorLine)
    }

    @MainActor
    func testAttachLocalBookAndReadingProgress() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("RoachArchiveAttachTests-\(UUID().uuidString)", isDirectory: true)
        let sourceURL = root.appendingPathComponent("source.epub")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try Data("book".utf8).write(to: sourceURL)
        defer {
            try? FileManager.default.removeItem(at: root)
        }

        let store = RoachArchiveStore()
        store.configure(storagePath: root.path)
        let result = RoachArchiveSearchResult(
            id: "attach-demo",
            title: "Attach Demo",
            authors: ["B. Roach"],
            format: "epub",
            source: "local metadata"
        )

        _ = await store.addToVault(result)
        let record = try XCTUnwrap(store.vaultRecords.first)
        let attached = try XCTUnwrap(store.attachLocalBook(sourceURL, to: record.id))
        XCTAssertTrue(FileManager.default.fileExists(atPath: attached.path))

        store.updateReadingProgress(1.4, for: record.id)
        let updated = try XCTUnwrap(store.vaultRecords.first)
        XCTAssertEqual(updated.filePath, attached.path)
        XCTAssertEqual(updated.readingProgress, 1)
        XCTAssertEqual(updated.status, "Read")
    }

    @MainActor
    func testAttachLocalBookSanitizesFormatBeforeBuildingDestinationPath() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("RoachArchiveFormatTests-\(UUID().uuidString)", isDirectory: true)
        let sourceURL = root.appendingPathComponent("source")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try Data("book".utf8).write(to: sourceURL)
        defer {
            try? FileManager.default.removeItem(at: root)
        }

        let store = RoachArchiveStore()
        store.configure(storagePath: root.path)
        let result = RoachArchiveSearchResult(
            id: "format-demo",
            title: "Format Demo",
            format: "../../private-key",
            source: "local metadata"
        )

        _ = await store.addToVault(result)
        let record = try XCTUnwrap(store.vaultRecords.first)
        let attached = try XCTUnwrap(store.attachLocalBook(sourceURL, to: record.id))
        let booksRoot = try XCTUnwrap(store.booksRootURL?.standardizedFileURL.path)

        XCTAssertEqual(attached.deletingLastPathComponent().standardizedFileURL.path, booksRoot)
        XCTAssertEqual(attached.lastPathComponent, "Format Demo.private-key")
    }
}
