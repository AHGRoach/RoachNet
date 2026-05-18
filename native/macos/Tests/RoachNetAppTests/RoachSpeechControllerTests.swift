import XCTest
@testable import RoachNetApp

@MainActor
final class RoachSpeechControllerTests: XCTestCase {
    func testRoachSpeechReportsNativeSTTAndTTSBackends() {
        let controller = RoachSpeechController()
        let snapshot = controller.capabilitySnapshot

        XCTAssertEqual(snapshot.engineName, "RoachSpeech")
        XCTAssertEqual(snapshot.speechToTextBackend, "Apple Speech.framework")
        XCTAssertEqual(snapshot.textToSpeechBackend, "AVSpeechSynthesizer")
        XCTAssertFalse(snapshot.localeIdentifier.isEmpty)
        XCTAssertFalse(snapshot.voiceName.isEmpty)
    }

    func testRoachSpeechDoesNotDescribeServerDictationAsReady() {
        let snapshot = RoachSpeechCapabilitySnapshot(
            engineName: "RoachSpeech",
            speechToTextBackend: "Apple Speech",
            textToSpeechBackend: "AVSpeechSynthesizer",
            localeIdentifier: "en-US",
            recognizerAvailable: true,
            supportsOnDeviceRecognition: false,
            voiceName: "System voice",
            nativeRuntime: RoachSpeechNativeRuntimeStatus(
                encoderModelPath: nil,
                decoderModelPath: nil,
                tokenizerPath: nil,
                parityManifestPath: nil,
                coreMLSource: "Apple native fallback",
                usesPackagedBinary: false
            )
        )

        XCTAssertEqual(snapshot.sttModeLabel, "STT unavailable")
        XCTAssertNotEqual(snapshot.readinessLabel, "Ready")
    }

    func testNativeRuntimeDetectsStagedCoreMLPackWithoutClaimingWhisperParity() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("RoachSpeechRuntimeTests-\(UUID().uuidString)", isDirectory: true)
        let roachSpeechRoot = root.appendingPathComponent("RoachSpeech", isDirectory: true)
        let encoderModel = roachSpeechRoot.appendingPathComponent("RoachWhisperEncoder.mlmodelc")
        let decoderModel = roachSpeechRoot.appendingPathComponent("RoachWhisperDecoder.mlmodelc")
        let tokenizer = roachSpeechRoot.appendingPathComponent("RoachWhisperTokenizer.json")
        let parityManifest = roachSpeechRoot.appendingPathComponent("RoachWhisperParity.json")

        for directory in [encoderModel, decoderModel] {
            try createCompiledModelBundle(at: directory)
        }
        try Data("{}".utf8).write(to: tokenizer)
        try Data(#"{"parity":"required"}"#.utf8).write(to: parityManifest)

        defer {
            try? FileManager.default.removeItem(at: root)
        }

        let status = RoachSpeechNativeRuntime.status(
            environment: [:],
            resourceRoots: [root],
            fileManager: .default
        )

        XCTAssertFalse(status.speechToTextReady)
        XCTAssertTrue(status.roachWhisperAssetsReady)
        XCTAssertFalse(status.whisperParityReady)
        XCTAssertTrue(status.textToSpeechReady)
        XCTAssertEqual(status.speechToTextLabel, "Apple Speech.framework")
        XCTAssertEqual(status.textToSpeechLabel, "AVSpeechSynthesizer")
        XCTAssertEqual(status.coreMLSource, "Bundled Core ML")
        XCTAssertEqual(status.parityLabel, "RoachWhisper staged")
        XCTAssertFalse(status.usesPackagedBinary)
    }

    func testModelPackManifestDetectsStagedRoachWhisperWithoutClaimingReleaseReadiness() throws {
        let packRoot = try makeTemporaryDirectory()
        let whisperRoot = packRoot.appendingPathComponent("RoachWhisper", isDirectory: true)
        try FileManager.default.createDirectory(at: whisperRoot, withIntermediateDirectories: true)
        try createCompiledModelBundle(at: whisperRoot.appendingPathComponent("RoachWhisperEncoder.mlmodelc", isDirectory: true))
        try createCompiledModelBundle(at: whisperRoot.appendingPathComponent("RoachWhisperDecoder.mlmodelc", isDirectory: true))
        try Data("{}".utf8).write(to: whisperRoot.appendingPathComponent("RoachWhisperTokenizer.json"))
        try Data(#"{"parity":"not-yet-validated"}"#.utf8)
            .write(to: whisperRoot.appendingPathComponent("RoachWhisperParity.json"))
        try writePackManifest(
            RoachSpeechModelPackManifest(
                packID: "roachwhisper-small-coreml",
                displayName: "RoachWhisper Small",
                version: "0.1.0",
                kind: .roachWhisper,
                nativeFormat: .coreML,
                features: [.speechToText, .transcriptSidecars],
                nativeInferenceReady: false,
                parityValidated: false
            ),
            to: packRoot
        )

        let pack = try RoachSpeechModelPack.load(rootURL: packRoot)

        XCTAssertEqual(pack.manifest.packID, "roachwhisper-small-coreml")
        XCTAssertTrue(pack.whisperAssets.isStaged)
        XCTAssertFalse(pack.whisperAssets.isReleaseReady)
        XCTAssertEqual(pack.whisperAssets.statusLabel, "RoachWhisper staged; native inference not release-ready")
        XCTAssertTrue(pack.guaranteesNoNetworkOrPackagedBinary)
    }

    func testWhisperCppCoreMLEncoderCanBeUsedAsBaseWithoutCompletingNativePack() throws {
        let packRoot = try makeTemporaryDirectory()
        let whisperRoot = packRoot.appendingPathComponent("RoachWhisper", isDirectory: true)
        let encoderRoot = whisperRoot.appendingPathComponent("RoachWhisperEncoder.mlmodelc", isDirectory: true)
        try FileManager.default.createDirectory(at: encoderRoot, withIntermediateDirectories: true)
        try Data("coreml model marker".utf8).write(to: encoderRoot.appendingPathComponent("model.mil"))
        try writePackManifest(
            RoachSpeechModelPackManifest(
                packID: "roachwhisper-base-en-coreml",
                displayName: "RoachWhisper base.en",
                version: "0.1.0",
                kind: .roachWhisper,
                nativeFormat: .coreML,
                features: [.speechToText],
                nativeInferenceReady: false,
                parityValidated: false,
                provenance: RoachSpeechModelPackProvenance(
                    upstreamProject: "ggml-org/whisper.cpp",
                    upstreamModelName: "base.en",
                    sourceFormat: "ggml-base.en-encoder.mlmodelc",
                    conversionCommand: "./models/generate-coreml-model.sh base.en"
                )
            ),
            to: packRoot
        )

        let pack = try RoachSpeechModelPack.load(rootURL: packRoot)

        XCTAssertEqual(pack.manifest.provenance?.upstreamProject, "ggml-org/whisper.cpp")
        XCTAssertTrue(pack.whisperAssets.hasUsableEncoderModel)
        XCTAssertFalse(pack.whisperAssets.isStaged)
        XCTAssertFalse(pack.whisperAssets.isReleaseReady)
        XCTAssertEqual(pack.whisperAssets.statusLabel, "RoachWhisper encoder base imported; decoder/tokenizer/parity missing")
    }

    func testCompleteRoachWhisperPackRequiresNonEmptyNativeAssetsAndValidatedManifest() throws {
        let packRoot = try makeTemporaryDirectory()
        let whisperRoot = packRoot.appendingPathComponent("RoachWhisper", isDirectory: true)
        try FileManager.default.createDirectory(at: whisperRoot, withIntermediateDirectories: true)
        try createCompiledModelBundle(at: whisperRoot.appendingPathComponent("RoachWhisperEncoder.mlmodelc", isDirectory: true))
        try createCompiledModelBundle(at: whisperRoot.appendingPathComponent("RoachWhisperDecoder.mlmodelc", isDirectory: true))
        try createCompiledModelBundle(at: whisperRoot.appendingPathComponent("RoachWhisperMelSpectrogram.mlmodelc", isDirectory: true))
        try Data(#"{"tokenizer":"roachnet-native"}"#.utf8)
            .write(to: whisperRoot.appendingPathComponent("RoachWhisperTokenizer.json"))
        try Data(#"{"validatedFixture":"jfk.wav","wer":0.0,"nativeOnly":true}"#.utf8)
            .write(to: whisperRoot.appendingPathComponent("RoachWhisperParity.json"))
        try writePackManifest(
            RoachSpeechModelPackManifest(
                packID: "roachwhisper-base-en-coreml",
                displayName: "RoachWhisper base.en",
                version: "1.0.5",
                kind: .roachWhisper,
                nativeFormat: .coreML,
                features: [.speechToText, .transcriptSidecars, .lyricExtraction],
                nativeInferenceReady: true,
                parityValidated: true,
                provenance: RoachSpeechModelPackProvenance(
                    upstreamProject: "RoachWares/RoachNet",
                    upstreamModelName: "RoachWhisper base.en",
                    sourceFormat: "RoachSpeech native Core ML pack",
                    conversionCommand: "node scripts/create-roachspeech-native-pack.mjs --kind roachWhisper",
                    referenceProject: "ggml-org/whisper.cpp"
                )
            ),
            to: packRoot
        )

        let pack = try RoachSpeechModelPack.load(rootURL: packRoot)

        XCTAssertTrue(pack.whisperAssets.isStaged)
        XCTAssertTrue(pack.whisperAssets.melSpectrogramHasModelFiles)
        XCTAssertTrue(pack.whisperAssets.isReleaseReady)
        XCTAssertEqual(pack.whisperAssets.statusLabel, "RoachWhisper native pack ready")
    }

    func testCustomVoiceProjectsTrackLocalSamplesAndReadiness() {
        let microphoneProject = RoachSpeechCustomVoiceProject.microphoneProject(
            displayName: "RoachClaw Mic Draft",
            sampleURL: URL(fileURLWithPath: "/vault/voice/mic-take.wav"),
            durationSeconds: 42
        )

        XCTAssertEqual(microphoneProject.totalSampleDurationSeconds, 42)
        XCTAssertTrue(microphoneProject.isLocalOnly)
        XCTAssertTrue(microphoneProject.isReadyToPrepare)
        XCTAssertEqual(microphoneProject.preparationStatusLabel, "Ready to prepare local voice pack")
        XCTAssertEqual(microphoneProject.sampleRequirementLabel, "Minimum captured. More clean audio improves the clone.")
        XCTAssertTrue(microphoneProject.sampleProgress > 0)

        let importedProject = RoachSpeechCustomVoiceProject.importedProject(
            displayName: "Imported Hook Voice",
            sampleURL: URL(fileURLWithPath: "/vault/voice/hook.m4a"),
            durationSeconds: 12
        )

        XCTAssertEqual(importedProject.totalSampleDurationSeconds, 12)
        XCTAssertTrue(importedProject.isLocalOnly)
        XCTAssertFalse(importedProject.isReadyToPrepare)
        XCTAssertEqual(importedProject.preparationStatusLabel, "Needs 18s more local sample audio")
        XCTAssertEqual(importedProject.sampleRequirementLabel, "Needs 18s more local voice.")
    }

    func testControllerCreatesCustomVoiceProjectsFromMicAndImportedRecordings() {
        let micProject = RoachSpeechController.microphoneVoiceProject(
            displayName: "Mic Voice",
            recordingURL: URL(fileURLWithPath: "/vault/voices/mic.wav"),
            durationSeconds: 60
        )
        let importedProject = RoachSpeechController.importedVoiceProject(
            displayName: "Imported Voice",
            recordingURL: URL(fileURLWithPath: "/vault/voices/imported.m4a"),
            durationSeconds: 45
        )

        XCTAssertEqual(micProject.samples.first?.source, .microphone)
        XCTAssertEqual(importedProject.samples.first?.source, .importedFile)
        XCTAssertTrue(micProject.canPrepareNativeVoicePack)
        XCTAssertTrue(importedProject.canPrepareNativeVoicePack)
        XCTAssertTrue(micProject.isLocalOnly)
        XCTAssertTrue(importedProject.isLocalOnly)
    }

    func testVoiceProfilesSwitchAndUpgradeByModelPackPath() throws {
        let firstPack = try makeVoicePack(displayName: "RoachClaw Voice", version: "0.1.0")
        let upgradedPack = try makeVoicePack(displayName: "RoachClaw Voice", version: "0.2.0")

        let project = RoachSpeechCustomVoiceProject.microphoneProject(
            displayName: "RoachClaw Voice",
            sampleURL: URL(fileURLWithPath: "/vault/voice/take.wav"),
            durationSeconds: 90
        )
        let profile = RoachSpeechVoiceProfile.custom(project: project, modelPack: firstPack)
        let upgradedProfile = profile.upgrading(to: upgradedPack)

        XCTAssertEqual(profile.kind, .customProject)
        XCTAssertEqual(profile.modelPackRootPath, firstPack.rootURL.path)
        XCTAssertEqual(profile.statusLabel, "Custom voice pack staged; native synthesis gated")
        XCTAssertTrue(profile.requiresNativeVoicePack)
        XCTAssertFalse(profile.canUseCustomSynthesis)
        XCTAssertEqual(upgradedProfile.modelPackRootPath, upgradedPack.rootURL.path)
        XCTAssertEqual(upgradedProfile.modelPackVersion, "0.2.0")
    }

    func testReleaseReadyRoachVoicePackEnablesCustomVoiceSynthesis() throws {
        let voicePack = try makeVoicePack(displayName: "RoachClaw Voice", version: "1.0.5", nativeInferenceReady: true)
        let project = RoachSpeechCustomVoiceProject.microphoneProject(
            displayName: "RoachClaw Voice",
            sampleURL: URL(fileURLWithPath: "/vault/voice/take.wav"),
            durationSeconds: 180
        )
        let profile = RoachSpeechVoiceProfile.custom(project: project, modelPack: voicePack)
        let status = RoachSpeechNativeRuntimeStatus(
            encoderModelPath: nil,
            decoderModelPath: nil,
            tokenizerPath: nil,
            parityManifestPath: nil,
            coreMLSource: "Bundled Core ML",
            usesPackagedBinary: false,
            roachVoiceAssets: voicePack.voiceAssets,
            voicePackCount: 1
        )

        XCTAssertTrue(voicePack.voiceAssets.isSynthesisReady)
        XCTAssertTrue(status.customVoiceSynthesisReady)
        XCTAssertEqual(status.textToSpeechLabel, "RoachVoice")
        XCTAssertEqual(status.voiceLabel, "Custom voice pack ready")
        XCTAssertEqual(profile.statusLabel, "Custom voice pack ready")
        XCTAssertTrue(profile.canUseCustomSynthesis)
    }

    func testReleaseReadyCombinedNarratorPackEnablesCustomVoiceSynthesis() throws {
        let packRoot = try makeTemporaryDirectory()
        let voiceRoot = packRoot.appendingPathComponent("RoachVoice", isDirectory: true)
        try FileManager.default.createDirectory(at: voiceRoot, withIntermediateDirectories: true)
        try createCompiledModelBundle(at: voiceRoot.appendingPathComponent("RoachVoiceNarrator.mlmodelc", isDirectory: true))
        try createCompiledModelBundle(at: voiceRoot.appendingPathComponent("RoachVoiceG2PEncoder.mlmodelc", isDirectory: true))
        try createCompiledModelBundle(at: voiceRoot.appendingPathComponent("RoachVoiceG2PDecoder.mlmodelc", isDirectory: true))
        try Data(#"{"defaultVoice":"af_heart","localOnly":true}"#.utf8)
            .write(to: voiceRoot.appendingPathComponent("RoachVoiceEmbedding.json"))
        try writePackManifest(
            RoachSpeechModelPackManifest(
                packID: "roachvoice-kokoro-82m-int8-coreml",
                displayName: "RoachVoice Kokoro 82M INT8",
                version: "1.0.5",
                kind: .roachVoice,
                nativeFormat: .coreML,
                features: [.customVoiceSynthesis],
                nativeInferenceReady: true,
                parityValidated: false,
                provenance: RoachSpeechModelPackProvenance(
                    upstreamProject: "RoachWares/RoachNet",
                    upstreamModelName: "RoachVoice Kokoro 82M INT8",
                    sourceFormat: "Kokoro 82M Core ML INT8 pack",
                    conversionCommand: "node scripts/import-roachvoice-kokoro-coreml.mjs",
                    referenceProject: "hexgrad/Kokoro-82M"
                )
            ),
            to: packRoot
        )

        let voicePack = try RoachSpeechModelPack.load(rootURL: packRoot)
        let status = RoachSpeechNativeRuntimeStatus(
            encoderModelPath: nil,
            decoderModelPath: nil,
            tokenizerPath: nil,
            parityManifestPath: nil,
            coreMLSource: "Bundled Core ML",
            usesPackagedBinary: false,
            roachVoiceAssets: voicePack.voiceAssets,
            voicePackCount: 1
        )

        XCTAssertTrue(voicePack.voiceAssets.hasCombinedNarratorModel)
        XCTAssertFalse(voicePack.voiceAssets.hasSplitSynthesisModels)
        XCTAssertTrue(voicePack.voiceAssets.isSynthesisReady)
        XCTAssertTrue(status.customVoiceSynthesisReady)
        XCTAssertEqual(status.textToSpeechLabel, "RoachVoice")
        XCTAssertEqual(status.voiceLabel, "Custom voice pack ready")
    }

    func testChatterboxTurboPackEnablesNativeVoiceCloning() throws {
        let packRoot = try makeTemporaryDirectory()
        let voiceRoot = packRoot.appendingPathComponent("RoachVoice", isDirectory: true)
        try FileManager.default.createDirectory(at: voiceRoot, withIntermediateDirectories: true)
        for bundleName in [
            "RoachVoiceLanguageModel.mlmodelc",
            "RoachVoiceConditionalDecoder.mlmodelc",
            "RoachVoiceSpeechEncoder.mlmodelc",
            "RoachVoiceEmbedTokens.mlmodelc",
        ] {
            try createCompiledModelBundle(at: voiceRoot.appendingPathComponent(bundleName, isDirectory: true))
        }
        try Data(#"{"tokenizer":"roachvoice-chatterbox-turbo"}"#.utf8)
            .write(to: voiceRoot.appendingPathComponent("RoachVoiceTokenizer.json"))
        try Data(#"{"speakerEmbedding":"local-reference-audio","localOnly":true}"#.utf8)
            .write(to: voiceRoot.appendingPathComponent("RoachVoiceEmbedding.json"))
        try writePackManifest(
            RoachSpeechModelPackManifest(
                packID: "roachvoice-chatterbox-turbo-coreml",
                displayName: "RoachVoice Chatterbox-Turbo",
                version: "1.0.5",
                kind: .roachVoice,
                nativeFormat: .coreML,
                features: [.customVoiceSynthesis, .voiceCloning, .paralinguisticTags, .watermarking],
                nativeInferenceReady: true,
                parityValidated: false,
                provenance: RoachSpeechModelPackProvenance(
                    upstreamProject: "RoachWares/RoachNet",
                    upstreamModelName: "RoachVoice Chatterbox-Turbo",
                    sourceFormat: "RoachSpeech native Core ML Chatterbox-Turbo pack",
                    conversionCommand: "node scripts/create-roachspeech-native-pack.mjs --kind roachVoice",
                    referenceProject: "ResembleAI/chatterbox-turbo MIT reference"
                )
            ),
            to: packRoot
        )

        let voicePack = try RoachSpeechModelPack.load(rootURL: packRoot)
        let status = RoachSpeechNativeRuntimeStatus(
            encoderModelPath: nil,
            decoderModelPath: nil,
            tokenizerPath: nil,
            parityManifestPath: nil,
            coreMLSource: "Bundled Core ML",
            usesPackagedBinary: false,
            roachVoiceAssets: voicePack.voiceAssets,
            voicePackCount: 1
        )

        XCTAssertTrue(voicePack.voiceAssets.hasChatterboxTurboStack)
        XCTAssertTrue(voicePack.voiceAssets.isSynthesisReady)
        XCTAssertTrue(voicePack.voiceAssets.isVoiceCloningReady)
        XCTAssertTrue(status.customVoiceCloningReady)
        XCTAssertEqual(status.voiceLabel, "RoachVoice cloning pack ready")
    }

    func testVoiceInventoryPrefersCloningPackOverNarratorFallback() throws {
        let narratorPack = try makeVoicePack(
            displayName: "RoachVoice Small Narrator",
            version: "1.0.5",
            nativeInferenceReady: true
        )
        let cloningPackRoot = try makeTemporaryDirectory()
        let voiceRoot = cloningPackRoot.appendingPathComponent("RoachVoice", isDirectory: true)
        try FileManager.default.createDirectory(at: voiceRoot, withIntermediateDirectories: true)
        for bundleName in [
            "RoachVoiceLanguageModel.mlmodelc",
            "RoachVoiceConditionalDecoder.mlmodelc",
            "RoachVoiceSpeechEncoder.mlmodelc",
            "RoachVoiceEmbedTokens.mlmodelc",
        ] {
            try createCompiledModelBundle(at: voiceRoot.appendingPathComponent(bundleName, isDirectory: true))
        }
        try Data(#"{"tokenizer":"roachvoice-chatterbox"}"#.utf8)
            .write(to: voiceRoot.appendingPathComponent("RoachVoiceTokenizer.json"))
        try Data(#"{"speakerEmbedding":"local","localOnly":true}"#.utf8)
            .write(to: voiceRoot.appendingPathComponent("RoachVoiceEmbedding.json"))
        try writePackManifest(
            RoachSpeechModelPackManifest(
                packID: "roachvoice-chatterbox-coreml",
                displayName: "RoachVoice Chatterbox",
                version: "1.0.5",
                kind: .roachVoice,
                nativeFormat: .coreML,
                features: [.customVoiceSynthesis, .voiceCloning],
                nativeInferenceReady: true,
                parityValidated: false,
                provenance: RoachSpeechModelPackProvenance(
                    upstreamProject: "RoachWares/RoachNet",
                    upstreamModelName: "RoachVoice Chatterbox",
                    sourceFormat: "RoachSpeech native Core ML component pack",
                    conversionCommand: "node scripts/import-roachvoice-chatterbox-coreml.mjs",
                    referenceProject: "ResembleAI/chatterbox"
                )
            ),
            to: cloningPackRoot
        )
        let cloningPack = try RoachSpeechModelPack.load(rootURL: cloningPackRoot)
        let inventory = RoachSpeechRuntimeInventory(
            whisperPack: nil,
            voicePacks: [narratorPack, cloningPack]
        )

        XCTAssertTrue(narratorPack.voiceAssets.isSynthesisReady)
        XCTAssertFalse(narratorPack.voiceAssets.isVoiceCloningReady)
        XCTAssertTrue(cloningPack.voiceAssets.isVoiceCloningReady)
        XCTAssertEqual(inventory.primaryVoiceAssets?.statusLabel, "RoachVoice cloning pack ready")
    }

    func testVaultVoiceActionsStageSidecarsAndGateNativePackRequirements() throws {
        let status = RoachSpeechNativeRuntimeStatus(
            encoderModelPath: nil,
            decoderModelPath: nil,
            tokenizerPath: nil,
            parityManifestPath: nil,
            coreMLSource: "Apple native fallback",
            usesPackagedBinary: false
        )
        let systemProfile = RoachSpeechVoiceProfile.systemDefault

        let bookURL = URL(fileURLWithPath: "/vault/books/manual.epub")
        let audioURL = URL(fileURLWithPath: "/vault/music/song.flac")
        let videoURL = URL(fileURLWithPath: "/vault/video/session.mov")

        let readPlan = RoachSpeechVaultActionPlan.plan(action: .readAloud, sourceURL: bookURL)
        let transcriptPlan = RoachSpeechVaultActionPlan.plan(action: .generateTranscriptSidecar, sourceURL: audioURL)
        let lyricsPlan = RoachSpeechVaultActionPlan.plan(action: .extractLyrics, sourceURL: audioURL)
        let videoPlan = RoachSpeechVaultActionPlan.plan(action: .transcribeVideo, sourceURL: videoURL)
        let bookPlans = RoachSpeechController.vaultActionPlans(for: bookURL)
        let audioPlans = RoachSpeechController.vaultActionPlans(for: audioURL)
        let videoPlans = RoachSpeechController.vaultActionPlans(for: videoURL)

        XCTAssertEqual(readPlan.outputURL, nil)
        XCTAssertTrue(readPlan.isReady(runtime: status, voiceProfile: systemProfile))
        XCTAssertEqual(readPlan.statusLabel(runtime: status, voiceProfile: systemProfile), "Ready with system voice")
        XCTAssertEqual(bookPlans.map(\.action), [.readAloud])

        XCTAssertEqual(transcriptPlan.outputURL?.lastPathComponent, "song.transcript.json")
        XCTAssertFalse(transcriptPlan.isReady(runtime: status, voiceProfile: systemProfile))
        XCTAssertEqual(transcriptPlan.statusLabel(runtime: status, voiceProfile: systemProfile), "Requires release-ready native RoachWhisper pack")
        XCTAssertEqual(audioPlans.map(\.action), [.transcribeAudio, .extractLyrics, .generateTranscriptSidecar])

        XCTAssertEqual(lyricsPlan.outputURL?.lastPathComponent, "song.lyrics.txt")
        XCTAssertFalse(lyricsPlan.isReady(runtime: status, voiceProfile: systemProfile))

        XCTAssertEqual(videoPlan.outputURL?.lastPathComponent, "session.transcript.json")
        XCTAssertFalse(videoPlan.isReady(runtime: status, voiceProfile: systemProfile))
        XCTAssertEqual(videoPlans.map(\.action), [.transcribeVideo, .generateTranscriptSidecar])
    }

    func testFallbackSystemVoiceRemainsAvailableWithoutCustomVoicePack() {
        let profile = RoachSpeechVoiceProfile.systemDefault

        XCTAssertEqual(profile.kind, .systemVoice)
        XCTAssertTrue(profile.canFallbackToSystemVoice)
        XCTAssertEqual(profile.statusLabel, "System voice ready")
        XCTAssertNil(profile.modelPackRootPath)
    }

    func testRoachSpeechDoesNotDependOnPackagedSpeechBinaries() {
        let status = RoachSpeechNativeRuntime.status(
            environment: [:],
            resourceRoots: [],
            fileManager: .default
        )

        XCTAssertFalse(status.usesPackagedBinary)
    }

    private func makeVoicePack(
        displayName: String,
        version: String,
        nativeInferenceReady: Bool = false
    ) throws -> RoachSpeechModelPack {
        let packRoot = try makeTemporaryDirectory()
        let voiceRoot = packRoot.appendingPathComponent("RoachVoice", isDirectory: true)
        try FileManager.default.createDirectory(at: voiceRoot, withIntermediateDirectories: true)
        try createCompiledModelBundle(at: voiceRoot.appendingPathComponent("RoachVoiceAcoustic.mlmodelc", isDirectory: true))
        try createCompiledModelBundle(at: voiceRoot.appendingPathComponent("RoachVoiceVocoder.mlmodelc", isDirectory: true))
        try Data("{}".utf8).write(to: voiceRoot.appendingPathComponent("RoachVoiceEmbedding.json"))
        try writePackManifest(
            RoachSpeechModelPackManifest(
                packID: "roachvoice-\(version)",
                displayName: displayName,
                version: version,
                kind: .roachVoice,
                nativeFormat: .coreML,
                features: [.customVoiceSynthesis],
                nativeInferenceReady: nativeInferenceReady,
                parityValidated: false,
                provenance: RoachSpeechModelPackProvenance(
                    upstreamProject: "RoachWares/RoachNet",
                    upstreamModelName: displayName,
                    sourceFormat: "RoachSpeech native Core ML pack",
                    conversionCommand: "node scripts/create-roachspeech-native-pack.mjs --kind roachVoice"
                )
            ),
            to: packRoot
        )
        return try RoachSpeechModelPack.load(rootURL: packRoot)
    }

    private func writePackManifest(_ manifest: RoachSpeechModelPackManifest, to packRoot: URL) throws {
        let data = try JSONEncoder().encode(manifest)
        try data.write(to: packRoot.appendingPathComponent(RoachSpeechModelPack.manifestFileName))
    }

    private func createCompiledModelBundle(at url: URL) throws {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try Data("coreml compiled model marker".utf8).write(to: url.appendingPathComponent("model.mil"))
    }

    private func makeTemporaryDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("RoachSpeechControllerTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock {
            try? FileManager.default.removeItem(at: directory)
        }
        return directory
    }
}
