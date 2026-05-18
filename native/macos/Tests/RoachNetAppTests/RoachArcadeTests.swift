import XCTest
@testable import RoachNetApp

final class RoachArcadeTests: XCTestCase {
    func testCoreResolverMapsCommonRomExtensions() {
        XCTAssertEqual(
            RoachArcadeCoreResolver.core(forSystem: "Super Nintendo", path: "/Games/Chrono Trigger.sfc"),
            "snes"
        )
        XCTAssertEqual(
            RoachArcadeCoreResolver.core(forSystem: "Nintendo 64", path: "/Games/Mario.z64"),
            "n64"
        )
        XCTAssertEqual(
            RoachArcadeCoreResolver.core(forSystem: "Game Boy Advance", path: "/Games/Metroid.gba"),
            "gba"
        )
        XCTAssertEqual(
            RoachArcadeCoreResolver.core(forSystem: "PC Engine", path: "/Games/Bonk.pce"),
            "pce"
        )
        XCTAssertEqual(
            RoachArcadeCoreResolver.core(forSystem: "Atari 2600", path: "/Games/Pitfall.a26"),
            "atari2600"
        )
    }

    func testRomGameStoresCheatsAndUsesResolvedCore() {
        var game = RoachArcadeGame(
            title: "Demo ROM",
            kind: .rom,
            system: "NES",
            source: "Local ROM folder",
            romPath: "/tmp/demo.nes",
            tags: ["retro"]
        )
        game.cheats.append(RoachArcadeCheat(name: "Infinite Lives", code: "SXIOPO"))

        XCTAssertEqual(game.resolvedCore, "nes")
        XCTAssertEqual(game.cheats.first?.name, "Infinite Lives")
        XCTAssertEqual(game.tags, ["retro"])
    }

    func testWorkspacePaneExposesRoachArcadeAsNativeSurface() {
        XCTAssertTrue(WorkspacePane.allCases.contains(.arcade))
        XCTAssertEqual(WorkspacePane.arcade.icon, "gamecontroller.fill")
        XCTAssertEqual(WorkspacePane.arcade.subtitle, "Game library")
    }

    func testGameDecodesLegacyLibraryWithoutCompatibilityRunner() throws {
        let json = """
        {
          "id": "11111111-1111-1111-1111-111111111111",
          "title": "Old ROM",
          "kind": "rom",
          "system": "NES",
          "source": "Legacy library",
          "status": "tracked",
          "romPath": "/tmp/old.nes",
          "notes": "",
          "tags": [],
          "cheats": [],
          "playCount": 0,
          "createdAt": "2026-05-02T00:00:00Z",
          "updatedAt": "2026-05-02T00:00:00Z"
        }
        """
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let game = try decoder.decode(RoachArcadeGame.self, from: Data(json.utf8))

        XCTAssertEqual(game.compatibilityRunner, .native)
        XCTAssertFalse(game.favorite)
        XCTAssertEqual(game.resolvedCore, "nes")
    }

    func testEmbeddedPlayerSanitizerKeepsMetadataInsideScriptAndAttributes() throws {
        let titleLiteral = RoachArcadeHTMLSanitizer.javaScriptStringLiteral("</script><script>alert(1)</script>")
        let cheatsData = try JSONSerialization.data(
            withJSONObject: [["Boss \"skip\"", "</script><img src=x onerror=alert(1)>"]],
            options: []
        )
        let cheatsLiteral = RoachArcadeHTMLSanitizer.javaScriptLiteral(jsonData: cheatsData)
        let attribute = RoachArcadeHTMLSanitizer.htmlAttributeValue("https://cdn.example.test/data/\" onload=\"alert(1)")

        XCTAssertFalse(titleLiteral.lowercased().contains("</script>"))
        XCTAssertFalse(cheatsLiteral.lowercased().contains("</script>"))
        XCTAssertFalse(attribute.contains("\""))
        XCTAssertTrue(attribute.contains("&quot;"))
        XCTAssertTrue(titleLiteral.hasPrefix("\""))
        XCTAssertTrue(titleLiteral.hasSuffix("\""))
    }

    @MainActor
    func testLibraryStoreImportsESDEGameListMetadata() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("RoachArcadeESDETests-\(UUID().uuidString)", isDirectory: true)
        let systemRoot = root.appendingPathComponent("snes", isDirectory: true)
        let mediaRoot = systemRoot.appendingPathComponent("media", isDirectory: true)
        let romURL = systemRoot.appendingPathComponent("Chrono Trigger.sfc")
        let artworkURL = mediaRoot.appendingPathComponent("chrono.png")
        let gameListURL = systemRoot.appendingPathComponent("gamelist.xml")

        try FileManager.default.createDirectory(at: mediaRoot, withIntermediateDirectories: true)
        try Data([0x53, 0x46, 0x43]).write(to: romURL)
        try Data([0x89, 0x50, 0x4e, 0x47]).write(to: artworkURL)
        try """
        <?xml version="1.0"?>
        <gameList>
          <game>
            <path>./Chrono Trigger.sfc</path>
            <name>Chrono Trigger</name>
            <desc>Time travel backlog fossil.</desc>
            <image>./media/chrono.png</image>
          </game>
        </gameList>
        """.write(to: gameListURL, atomically: true, encoding: .utf8)

        defer {
            try? FileManager.default.removeItem(at: root)
        }

        let store = RoachArcadeLibraryStore()
        store.configure(storagePath: root.path)
        store.importESDELibrary(root)

        let game = try XCTUnwrap(store.games.first)
        XCTAssertEqual(game.title, "Chrono Trigger")
        XCTAssertEqual(game.system, "snes")
        XCTAssertEqual(game.source, "ES-DE")
        XCTAssertEqual(game.romPath, romURL.path)
        XCTAssertEqual(game.artworkPath, artworkURL.path)
        XCTAssertEqual(game.notes, "Time travel backlog fossil.")
        XCTAssertEqual(game.resolvedCore, "snes")
        XCTAssertEqual(game.status, .ready)
    }

    @MainActor
    func testESDEImportDoesNotCapLargeLibraries() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("RoachArcadeESDELargeTests-\(UUID().uuidString)", isDirectory: true)
        let systemRoot = root.appendingPathComponent("nes", isDirectory: true)
        let gameListURL = systemRoot.appendingPathComponent("gamelist.xml")

        try FileManager.default.createDirectory(at: systemRoot, withIntermediateDirectories: true)
        let gamesXML = (0..<5_010).map { index in
            """
              <game>
                <path>./Game-\(index).nes</path>
                <name>Game \(index)</name>
              </game>
            """
        }.joined(separator: "\n")
        try """
        <?xml version="1.0"?>
        <gameList>
        \(gamesXML)
        </gameList>
        """.write(to: gameListURL, atomically: true, encoding: .utf8)

        defer {
            try? FileManager.default.removeItem(at: root)
        }

        let store = RoachArcadeLibraryStore()
        store.configure(storagePath: root.path)
        store.importESDELibrary(root)

        XCTAssertEqual(store.games.count, 5_010)
        XCTAssertEqual(store.systemShelf.first?.system, "nes")
        XCTAssertEqual(store.systemShelf.first?.count, 5_010)
    }

    @MainActor
    func testLibraryStoreTogglesCheatsAndStoresModDirectory() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("RoachArcadeTests-\(UUID().uuidString)", isDirectory: true)
        let romURL = root.appendingPathComponent("demo.nes")
        let modURL = root.appendingPathComponent("mods", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try Data([0x4e, 0x45, 0x53]).write(to: romURL)
        try FileManager.default.createDirectory(at: modURL, withIntermediateDirectories: true)
        defer {
            try? FileManager.default.removeItem(at: root)
        }

        let store = RoachArcadeLibraryStore()
        store.configure(storagePath: root.path)
        store.importROMFolder(root)

        let game = try XCTUnwrap(store.games.first)
        store.addCheat(to: game.id, name: "Infinite Lives", code: "SXIOPO")
        let cheat = try XCTUnwrap(store.games.first?.cheats.first)
        XCTAssertTrue(cheat.enabled)

        store.toggleCheat(cheat.id, for: game.id)
        XCTAssertFalse(try XCTUnwrap(store.games.first?.cheats.first).enabled)

        store.setModDirectory(modURL, for: game.id)
        XCTAssertEqual(store.games.first?.modDirectoryPath, modURL.path)
    }

    @MainActor
    func testLibraryFilterFavoritesAndMetadataUpdates() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("RoachArcadeMetadataTests-\(UUID().uuidString)", isDirectory: true)
        let romURL = root.appendingPathComponent("favorite.nes")
        let artworkURL = root.appendingPathComponent("cover.png")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try Data([0x4e, 0x45, 0x53]).write(to: romURL)
        try Data([0x89, 0x50, 0x4e, 0x47]).write(to: artworkURL)
        defer {
            try? FileManager.default.removeItem(at: root)
        }

        let store = RoachArcadeLibraryStore()
        store.configure(storagePath: root.path)
        store.importROMFolder(root)

        let game = try XCTUnwrap(store.games.first)
        store.toggleFavorite(game.id)
        store.updateGameMetadata(
            gameID: game.id,
            notes: "Keep this one ready for couch co-op.",
            tagsText: "retro, test, retro",
            artworkPath: artworkURL.path,
            storeURL: "https://example.invalid/game",
            runnerPath: "",
            bottlePath: ""
        )
        store.libraryFilter = .favorites

        let updated = try XCTUnwrap(store.filteredGames.first)
        XCTAssertTrue(updated.favorite)
        XCTAssertEqual(updated.notes, "Keep this one ready for couch co-op.")
        XCTAssertEqual(updated.tags, ["retro", "test"])
        XCTAssertEqual(updated.artworkPath, artworkURL.path)
        XCTAssertEqual(store.stats.favorites, 1)
    }

    @MainActor
    func testVortexManifestImportsModsAndDeploysOnlyEnabledEntries() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("RoachArcadeVortexTests-\(UUID().uuidString)", isDirectory: true)
        let executableURL = root.appendingPathComponent("NativeGame.app", isDirectory: true)
        let sourceRoot = root.appendingPathComponent("collection", isDirectory: true)
        let modsRoot = sourceRoot.appendingPathComponent("mods", isDirectory: true)
        let fastMod = modsRoot.appendingPathComponent("FastMod", isDirectory: true)
        let disabledMod = modsRoot.appendingPathComponent("DisabledMod", isDirectory: true)
        let deployRoot = root.appendingPathComponent("GameMods", isDirectory: true)
        try FileManager.default.createDirectory(at: executableURL, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: fastMod, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: disabledMod, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: deployRoot, withIntermediateDirectories: true)
        try """
        {
          "mods": [
            {"name":"FastMod","path":"mods/FastMod","enabled":true,"loadOrder":2},
            {"name":"DisabledMod","path":"mods/DisabledMod","enabled":false,"loadOrder":1}
          ]
        }
        """.write(to: sourceRoot.appendingPathComponent("collection.json"), atomically: true, encoding: .utf8)
        defer {
            try? FileManager.default.removeItem(at: root)
        }

        var game = RoachArcadeGame(
            title: "Native Game",
            kind: .macOS,
            system: "macOS",
            source: "Test",
            executablePath: executableURL.path,
            modDirectoryPath: deployRoot.path
        )

        let store = RoachArcadeLibraryStore()
        store.configure(storagePath: root.path)
        store.addGame(game)
        game = try XCTUnwrap(store.games.first)
        store.importVortexCollection(
            gameID: game.id,
            title: "Collection One",
            sourceURL: "https://example.invalid/collection",
            localFolderURL: sourceRoot
        )

        let profile = try XCTUnwrap(store.library.modProfiles.first)
        XCTAssertEqual(profile.mods.map(\.name), ["DisabledMod", "FastMod"])
        XCTAssertEqual(profile.mods.map(\.enabled), [false, true])

        store.deployProfile(profile, for: game)
        let deployedRoot = deployRoot.appendingPathComponent("RoachArcade-Collection One", isDirectory: true)
        XCTAssertFalse(FileManager.default.fileExists(atPath: deployedRoot.appendingPathComponent("001-DisabledMod").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: deployedRoot.appendingPathComponent("002-FastMod").path))
    }

    @MainActor
    func testWindowsGameNeedsRunnerBeforeItClaimsReady() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("RoachArcadeRunnerTests-\(UUID().uuidString)", isDirectory: true)
        let executableURL = root.appendingPathComponent("DemoGame.exe")
        let runnerURL = root.appendingPathComponent("runner.sh")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try Data("exe".utf8).write(to: executableURL)
        try Data("#!/bin/sh\n".utf8).write(to: runnerURL)
        defer {
            try? FileManager.default.removeItem(at: root)
        }

        let store = RoachArcadeLibraryStore()
        store.configure(storagePath: root.path)

        var game = RoachArcadeGame(
            title: "Demo Windows Game",
            kind: .windows,
            system: "Windows",
            source: "Test fixture",
            executablePath: executableURL.path,
            compatibilityRunner: .external
        )
        store.addGame(game)
        XCTAssertEqual(store.games.first?.status, .needsRunner)

        game.runnerPath = runnerURL.path
        store.addGame(game)
        XCTAssertEqual(store.games.first?.status, .ready)
    }
}
