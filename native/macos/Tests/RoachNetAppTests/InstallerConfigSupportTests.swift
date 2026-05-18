import XCTest
@testable import RoachNetCore

final class InstallerConfigSupportTests: XCTestCase {
    func testInstallerScratchPathRecognizesRegressionCheckRoots() {
        XCTAssertTrue(
            RoachNetRepositoryLocator.isInstallerScratchPath("/Users/example/RoachNet.regressioncheck")
        )
        XCTAssertTrue(
            RoachNetRepositoryLocator.isInstallerScratchPath("/tmp/RoachNet.staging-5B63")
        )
        XCTAssertFalse(
            RoachNetRepositoryLocator.isInstallerScratchPath("/Users/example/RoachNet")
        )
    }

    func testSanitizedPersistedConfigResetsScratchInstallRootBackToPublicDefault() {
        let scratchRoot = "/Users/example/RoachNet.regressioncheck"
        let config = RoachNetInstallerConfig(
            installPath: scratchRoot,
            installedAppPath: URL(fileURLWithPath: scratchRoot)
                .appendingPathComponent("app", isDirectory: true)
                .appendingPathComponent("RoachNet.app", isDirectory: true)
                .path,
            storagePath: URL(fileURLWithPath: scratchRoot)
                .appendingPathComponent("storage", isDirectory: true)
                .path,
            installRoachClaw: true,
            setupCompletedAt: "2026-04-20T00:00:00Z",
            bootstrapPending: true,
            bootstrapFailureCount: 2,
            lastRuntimeHealthAt: "2026-04-20T00:05:00Z",
            pendingLaunchIntro: true,
            pendingRoachClawSetup: true
        )

        let sanitized = RoachNetRepositoryLocator.sanitizedPersistedConfig(config)
        let expectedInstallPath = RoachNetRepositoryLocator.defaultInstallPath()

        XCTAssertEqual(sanitized.installPath, expectedInstallPath)
        XCTAssertEqual(
            sanitized.installedAppPath,
            RoachNetRepositoryLocator.defaultInstalledAppPath(installPath: expectedInstallPath)
        )
        XCTAssertEqual(
            sanitized.storagePath,
            RoachNetRepositoryLocator.defaultStoragePath(installPath: expectedInstallPath)
        )
        XCTAssertNil(sanitized.setupCompletedAt)
        XCTAssertFalse(sanitized.bootstrapPending)
        XCTAssertEqual(sanitized.bootstrapFailureCount, 0)
        XCTAssertNil(sanitized.lastRuntimeHealthAt)
        XCTAssertFalse(sanitized.pendingLaunchIntro)
        XCTAssertFalse(sanitized.pendingRoachClawSetup)
    }

    func testSanitizedPersistedConfigKeepsCustomInstallRoot() {
        let customRoot = "/Users/example/Applications/RoachNet"
        let config = RoachNetInstallerConfig(
            installPath: customRoot,
            installedAppPath: URL(fileURLWithPath: customRoot)
                .appendingPathComponent("app", isDirectory: true)
                .appendingPathComponent("RoachNet.app", isDirectory: true)
                .path,
            storagePath: URL(fileURLWithPath: customRoot)
                .appendingPathComponent("storage", isDirectory: true)
                .path,
            installRoachClaw: false
        )

        let sanitized = RoachNetRepositoryLocator.sanitizedPersistedConfig(config)

        XCTAssertEqual(sanitized.installPath, customRoot)
        XCTAssertEqual(sanitized.installedAppPath, config.installedAppPath)
        XCTAssertEqual(sanitized.storagePath, config.storagePath)
        XCTAssertFalse(sanitized.installRoachClaw)
    }

    func testRuntimeRouteURLResolvesOnlyLocalRuntimePaths() throws {
        let url = try ManagedAppRuntimeBridge.localRuntimeRouteURL(
            baseURLString: "http://roachnet:8080/home",
            path: "maps/atlas?pack=base#viewer"
        )

        XCTAssertEqual(url.absoluteString, "http://roachnet:8080/maps/atlas?pack=base#viewer")

        let apiURL = try ManagedAppRuntimeBridge.localRuntimeRouteURL(
            baseURLString: "http://127.0.0.1:8080/api/health",
            path: "/settings/system"
        )
        XCTAssertEqual(apiURL.absoluteString, "http://127.0.0.1:8080/settings/system")
    }

    func testRuntimeRouteURLRejectsExternalRouteForms() {
        XCTAssertThrowsError(
            try ManagedAppRuntimeBridge.localRuntimeRouteURL(
                baseURLString: "http://roachnet:8080/home",
                path: "//example.invalid/phish"
            )
        )
        XCTAssertThrowsError(
            try ManagedAppRuntimeBridge.localRuntimeRouteURL(
                baseURLString: "http://roachnet:8080/home",
                path: "https://example.invalid/phish"
            )
        )
        XCTAssertThrowsError(
            try ManagedAppRuntimeBridge.localRuntimeRouteURL(
                baseURLString: "file:///tmp/roachnet",
                path: "/home"
            )
        )
    }

    func testAppleSiliconLocalAIEnvironmentDefaultsRespectExplicitOverrides() {
        var environment = [
            "OLLAMA_NUM_PARALLEL": "2",
            "OLLAMA_KEEP_ALIVE": "30m"
        ]

        ManagedAppRuntimeBridge.applyAppleSiliconLocalAIEnvironmentDefaults(
            to: &environment,
            isAppleSiliconNative: true
        )

        XCTAssertEqual(environment["OLLAMA_NUM_PARALLEL"], "2")
        XCTAssertEqual(environment["OLLAMA_KEEP_ALIVE"], "30m")
        XCTAssertEqual(environment["OLLAMA_FLASH_ATTENTION"], "1")
        XCTAssertEqual(environment["OLLAMA_MAX_LOADED_MODELS"], "1")
        XCTAssertEqual(environment["OLLAMA_MAX_QUEUE"], "32")
        XCTAssertEqual(environment["ROACHNET_APPLE_SILICON_NATIVE"], "1")
        XCTAssertEqual(
            environment["ROACHNET_LOCAL_AI_PROFILE"],
            ManagedAppRuntimeBridge.appleSiliconLocalAIProfile
        )
    }

    func testAppleSiliconLocalAIEnvironmentDefaultsCanBeDisabled() {
        var environment = [
            "ROACHNET_DISABLE_APPLE_SILICON_AI_DEFAULTS": "1"
        ]

        ManagedAppRuntimeBridge.applyAppleSiliconLocalAIEnvironmentDefaults(
            to: &environment,
            isAppleSiliconNative: true
        )

        XCTAssertNil(environment["OLLAMA_FLASH_ATTENTION"])
        XCTAssertNil(environment["ROACHNET_LOCAL_AI_PROFILE"])
    }

    func testAppleSiliconLocalAIEnvironmentDefaultsSkipNonAppleSiliconRuntime() {
        var environment: [String: String] = [:]

        ManagedAppRuntimeBridge.applyAppleSiliconLocalAIEnvironmentDefaults(
            to: &environment,
            isAppleSiliconNative: false
        )

        XCTAssertTrue(environment.isEmpty)
    }
}
