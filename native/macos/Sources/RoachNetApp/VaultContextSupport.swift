import Foundation

#if canImport(PDFKit)
import PDFKit
#endif

enum VaultPreviewKind: Equatable {
    case markdown
    case audio
    case video
    case pdf
    case book
    case folder
    case generic

    static func resolve(for url: URL) -> VaultPreviewKind {
        if url.hasDirectoryPath {
            return .folder
        }

        switch url.pathExtension.lowercased() {
        case "md", "markdown":
            return .markdown
        case "mp3", "m4a", "wav", "flac", "ogg", "aac", "aiff":
            return .audio
        case "mp4", "m4v", "mov", "webm", "mkv":
            return .video
        case "pdf":
            return .pdf
        case "epub":
            return .book
        default:
            return .generic
        }
    }

    var shelfLabel: String {
        switch self {
        case .markdown:
            return "Notes Lane"
        case .audio:
            return "Listening Room"
        case .video:
            return "Screening Room"
        case .pdf, .book:
            return "Reader"
        case .folder:
            return "Shelf Folder"
        case .generic:
            return "Vault Preview"
        }
    }
}

enum RoachClawContextSupport {
    private static let excerptableExtensions: Set<String> = [
        "md", "markdown", "txt", "text", "rtf", "json", "yaml", "yml", "toml", "ini", "cfg",
        "csv", "tsv", "xml", "html", "css", "js", "jsx", "ts", "tsx", "swift", "py", "rb",
        "sh", "bash", "zsh", "fish", "c", "h", "hpp", "cpp", "m", "mm", "java", "kt", "go",
        "rs", "cs", "php", "sql", "log", "plist"
    ]

    static func textExcerpt(for url: URL, maxCharacters: Int = 420) -> String? {
        guard !url.hasDirectoryPath else { return nil }

        let fileExtension = url.pathExtension.lowercased()

        if excerptableExtensions.contains(fileExtension) {
            guard let data = try? Data(contentsOf: url), !data.isEmpty else {
                return nil
            }

            if let decoded = String(data: data, encoding: .utf8) {
                return normalizedExcerpt(decoded, maxCharacters: maxCharacters)
            }

            return normalizedExcerpt(String(decoding: data, as: UTF8.self), maxCharacters: maxCharacters)
        }

        #if canImport(PDFKit)
        if fileExtension == "pdf", let text = PDFDocument(url: url)?.string {
            return normalizedExcerpt(text, maxCharacters: maxCharacters)
        }
        #endif

        return nil
    }

    static func normalizedExcerpt(_ text: String, maxCharacters: Int) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        let squashed = trimmed
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: "\n")

        guard !squashed.isEmpty else { return nil }
        guard squashed.count > maxCharacters else { return squashed }
        return String(squashed.prefix(maxCharacters)).trimmingCharacters(in: .whitespacesAndNewlines) + "…"
    }
}
