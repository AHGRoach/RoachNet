import XCTest
@testable import RoachNetApp

final class RoachWhisperNativeEngineTests: XCTestCase {
    func testNativeAttributionKeepsWhisperCppLicenseVisible() {
        let attribution = RoachWhisperNativeAttribution()

        XCTAssertEqual(RoachWhisperNativeAttribution.upstreamProject, "ggml-org/whisper.cpp")
        XCTAssertEqual(RoachWhisperNativeAttribution.upstreamLicense, "MIT")
        XCTAssertTrue(attribution.summary.contains("RoachWhisper"))
        XCTAssertTrue(attribution.summary.contains("MIT"))
    }

    func testAudioFrontendCreatesWhisperSizedWindows() {
        let sampleCount = Int(RoachWhisperAudioFrontend.sampleRate * 65)
        let windows = RoachWhisperAudioFrontend.windows(sampleCount: sampleCount)

        XCTAssertEqual(windows.count, 3)
        XCTAssertEqual(windows[0].sampleRange.lowerBound, 0)
        XCTAssertEqual(windows[0].duration, 30, accuracy: 0.001)
        XCTAssertEqual(windows[1].startTime, 30, accuracy: 0.001)
        XCTAssertEqual(windows[2].duration, 5, accuracy: 0.001)
    }

    func testAudioFrontendNormalizesOnlyWhenPeakExceedsOne() {
        XCTAssertEqual(RoachWhisperAudioFrontend.normalized([0.25, -0.5, 1.0]), [0.25, -0.5, 1.0])

        let normalized = RoachWhisperAudioFrontend.normalized([0.5, -2.0, 1.0])

        XCTAssertEqual(normalized[0], 0.25, accuracy: 0.0001)
        XCTAssertEqual(normalized[1], -1.0, accuracy: 0.0001)
        XCTAssertEqual(normalized[2], 0.5, accuracy: 0.0001)
    }

    func testAudioFrontendPadsAndTrimsDeterministically() {
        XCTAssertEqual(RoachWhisperAudioFrontend.paddedOrTrimmed([1, 2, 3], targetCount: 5), [1, 2, 3, 0, 0])
        XCTAssertEqual(RoachWhisperAudioFrontend.paddedOrTrimmed([1, 2, 3], targetCount: 2), [1, 2])
    }

    func testNativeEngineRefusesInferenceUntilReleaseReadyAssetsExist() {
        let engine = RoachWhisperNativeEngine(assets: RoachWhisperAssets())

        XCTAssertFalse(engine.canExecuteNativeInference)
        XCTAssertThrowsError(try engine.assertReadyForNativeInference()) { error in
            XCTAssertEqual(error as? RoachWhisperNativeError, .missingReleaseReadyAssets)
        }
    }

    func testNativeEngineRefusesCoreMLSmokeUntilStagedAssetsExist() {
        let engine = RoachWhisperNativeEngine(assets: RoachWhisperAssets())

        XCTAssertThrowsError(try engine.smokeTestCoreMLPipeline(samples: [0, 0, 0])) { error in
            XCTAssertEqual(error as? RoachWhisperNativeError, .missingStagedAssets)
        }
    }

    func testNativeEngineBuildsPlanWithoutClaimingModelExecution() {
        let engine = RoachWhisperNativeEngine(assets: RoachWhisperAssets())
        let plan = engine.makePlan(
            for: URL(fileURLWithPath: "/tmp/source.wav"),
            sampleCount: Int(RoachWhisperAudioFrontend.sampleRate * 31)
        )

        XCTAssertEqual(plan.windows.count, 2)
        XCTAssertTrue(plan.isReadyForModelExecution)
        XCTAssertEqual(plan.attribution, RoachWhisperNativeAttribution())
        XCTAssertEqual(plan.audioURL.lastPathComponent, "source.wav")
    }

    func testTokenizerDecodesWhisperByteLevelTokens() throws {
        let tokenizerURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("RoachWhisperTokenizer-\(UUID().uuidString).json")
        defer {
            try? FileManager.default.removeItem(at: tokenizerURL)
        }
        try Data(
            #"{"model":{"vocab":{"hello":0,"Ġworld":1}},"added_tokens":[]}"#.utf8
        ).write(to: tokenizerURL)

        let tokenizer = try RoachWhisperTokenizer(url: tokenizerURL)

        XCTAssertEqual(tokenizer.decode(tokens: [0, 1]), "hello world")
    }

    func testLocalStagedCoreMLPackRunsSmokeAndGreedyDecodeWhenPresent() throws {
        let nativeMacOSRoot = Self.nativeMacOSRoot()
        let packRoot = nativeMacOSRoot
            .appendingPathComponent("Vendor/RoachSpeech/ModelPacks/roachwhisper-openai-whisper-base-en-coreml", isDirectory: true)
        guard FileManager.default.fileExists(atPath: packRoot.appendingPathComponent(RoachSpeechModelPack.manifestFileName).path) else {
            throw XCTSkip("Local RoachWhisper Core ML pack is not staged in this checkout.")
        }

        let pack = try RoachSpeechModelPack.load(rootURL: packRoot)
        let engine = RoachWhisperNativeEngine(assets: pack.whisperAssets)
        let samples = Array(repeating: Float(0), count: Int(RoachWhisperAudioFrontend.sampleRate))

        let smoke = try engine.smokeTestCoreMLPipeline(samples: samples)
        let transcript = try engine.transcribeWindow(samples: samples, maximumTokenCount: 4)

        XCTAssertEqual(smoke.melSpectrogramShape, [1, 80, 1, 3000])
        XCTAssertEqual(smoke.encoderOutputShape, [1, 512, 1, 1500])
        XCTAssertEqual(smoke.decoderLogitsShape, [1, 1, 51864])
        XCTAssertEqual(transcript.text, "")
        XCTAssertEqual(transcript.tokens, RoachWhisperNativeEngine.transcriptionPromptTokens)
    }

    func testLocalJFKFixtureDecodesExpectedTextWhenProvided() throws {
        guard let fixturePath = ProcessInfo.processInfo.environment["ROACHNET_WHISPER_PARITY_AUDIO"], !fixturePath.isEmpty else {
            throw XCTSkip("Set ROACHNET_WHISPER_PARITY_AUDIO to run the local transcript parity fixture.")
        }
        let packRoot = Self.nativeMacOSRoot()
            .appendingPathComponent("Vendor/RoachSpeech/ModelPacks/roachwhisper-openai-whisper-base-en-coreml", isDirectory: true)
        guard FileManager.default.fileExists(atPath: packRoot.appendingPathComponent(RoachSpeechModelPack.manifestFileName).path) else {
            throw XCTSkip("Local RoachWhisper Core ML pack is not staged in this checkout.")
        }

        let pack = try RoachSpeechModelPack.load(rootURL: packRoot)
        let engine = RoachWhisperNativeEngine(assets: pack.whisperAssets)
        let samples = try RoachWhisperAudioFrontend().loadMonoPCM16k(from: URL(fileURLWithPath: fixturePath))
        let transcript = try engine.transcribeWindow(samples: samples, maximumTokenCount: 32)

        XCTAssertTrue(transcript.text.localizedCaseInsensitiveContains("country can do for you"), transcript.text)
        XCTAssertTrue(transcript.text.localizedCaseInsensitiveContains("ask what you can do for your country"), transcript.text)
    }

    private static func nativeMacOSRoot() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }
}
