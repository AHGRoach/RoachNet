import AVFoundation
import Foundation
import Speech

@MainActor
final class RoachSpeechController: NSObject {
    enum SpeechError: LocalizedError {
        case unavailable
        case speechPermissionDenied
        case microphonePermissionDenied
        case startupFailed(String)

        var errorDescription: String? {
            switch self {
            case .unavailable:
                return "RoachNet could not bring up the local speech lane on this Mac."
            case .speechPermissionDenied:
                return "Allow Speech Recognition for RoachNet so voice prompts can stay on-device."
            case .microphonePermissionDenied:
                return "Allow Microphone access for RoachNet so it can capture voice prompts."
            case .startupFailed(let detail):
                return "RoachNet could not start the voice lane: \(detail)"
            }
        }
    }

    private let audioEngine = AVAudioEngine()
    private let synthesizer = AVSpeechSynthesizer()
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var transcriptionUpdate: ((String) -> Void)?
    private var transcriptionFinish: ((String) -> Void)?
    private var speechFinish: ((Bool) -> Void)?
    private var currentTranscript = ""
    private var didFinalizeTranscript = false
    private lazy var recognizer: SFSpeechRecognizer? = {
        SFSpeechRecognizer(locale: Locale(identifier: "en-US")) ?? SFSpeechRecognizer()
    }()

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func startTranscription(
        onUpdate: @escaping (String) -> Void,
        onFinish: @escaping (String) -> Void
    ) async throws {
        guard let recognizer, recognizer.isAvailable else {
            throw SpeechError.unavailable
        }

        try await requestPermissions()

        stopTranscription(commitResult: false)

        currentTranscript = ""
        didFinalizeTranscript = false
        transcriptionUpdate = onUpdate
        transcriptionFinish = onFinish

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        }

        recognitionRequest = request

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        inputNode.removeTap(onBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1_024, format: recordingFormat) { [weak self] buffer, _ in
            self?.recognitionRequest?.append(buffer)
        }

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self else { return }

            Task { @MainActor in
                if let result {
                    self.currentTranscript = result.bestTranscription.formattedString
                    self.transcriptionUpdate?(self.currentTranscript)

                    if result.isFinal {
                        self.didFinalizeTranscript = true
                        self.finishTranscription(notify: true)
                        return
                    }
                }

                if error != nil {
                    self.finishTranscription(notify: true)
                }
            }
        }

        do {
            audioEngine.prepare()
            try audioEngine.start()
        } catch {
            inputNode.removeTap(onBus: 0)
            recognitionTask?.cancel()
            recognitionTask = nil
            recognitionRequest = nil
            throw SpeechError.startupFailed(error.localizedDescription)
        }
    }

    func stopTranscription(commitResult: Bool = true) {
        finishTranscription(notify: commitResult && !didFinalizeTranscript)
    }

    func speak(_ text: String, completion: @escaping (Bool) -> Void) {
        stopSpeaking()

        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            completion(false)
            return
        }

        let utterance = AVSpeechUtterance(string: trimmed)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        utterance.rate = 0.48
        utterance.pitchMultiplier = 0.94
        utterance.volume = 0.92
        utterance.prefersAssistiveTechnologySettings = true

        speechFinish = completion
        synthesizer.speak(utterance)
    }

    func stopSpeaking() {
        guard synthesizer.isSpeaking else {
            speechFinish?(false)
            speechFinish = nil
            return
        }

        synthesizer.stopSpeaking(at: .immediate)
    }

    private func requestPermissions() async throws {
        let speechAuth = await Self.requestSpeechAuthorization()
        guard speechAuth == .authorized else {
            throw SpeechError.speechPermissionDenied
        }

        let microphoneAllowed = await Self.requestMicrophoneAuthorization()
        guard microphoneAllowed else {
            throw SpeechError.microphonePermissionDenied
        }
    }

    private func finishTranscription(notify: Bool) {
        if audioEngine.isRunning {
            audioEngine.stop()
        }

        audioEngine.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()

        recognitionRequest = nil
        recognitionTask = nil

        let finalTranscript = currentTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
        let finishHandler = transcriptionFinish

        currentTranscript = ""
        didFinalizeTranscript = false
        transcriptionUpdate = nil
        transcriptionFinish = nil

        if notify {
            finishHandler?(finalTranscript)
        }
    }

    private static func requestSpeechAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status)
            }
        }
    }

    private static func requestMicrophoneAuthorization() async -> Bool {
        await withCheckedContinuation { continuation in
            AVCaptureDevice.requestAccess(for: .audio) { allowed in
                continuation.resume(returning: allowed)
            }
        }
    }

    private func finishSpeechPlayback(_ finished: Bool) {
        let completion = speechFinish
        speechFinish = nil
        completion?(finished)
    }
}

extension RoachSpeechController: AVSpeechSynthesizerDelegate {
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor [weak self] in
            self?.finishSpeechPlayback(true)
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor [weak self] in
            self?.finishSpeechPlayback(false)
        }
    }
}
