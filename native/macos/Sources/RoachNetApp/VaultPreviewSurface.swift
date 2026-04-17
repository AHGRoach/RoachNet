import AppKit
import AVKit
#if canImport(PDFKit)
import PDFKit
#endif
import QuickLookUI
import SwiftUI
import RoachNetDesign

struct PresentedVaultAsset: Identifiable {
    let title: String
    let subtitle: String
    let url: URL

    var id: String { url.path }
}

private extension PresentedVaultAsset {
    var previewKind: VaultPreviewKind {
        VaultPreviewKind.resolve(for: url)
    }

    var isMarkdown: Bool {
        previewKind == .markdown
    }

    var isDirectory: Bool {
        previewKind == .folder
    }

    var previewHeadline: String {
        previewKind.shelfLabel
    }

    var previewDetail: String {
        switch previewKind {
        case .markdown:
            return "Edit markdown in place, keep the same file readable in Obsidian, and stop bouncing out to another notes app."
        case .audio:
            return "Play the track in RoachNet, keep the album art and file path in view, and stay inside the library."
        case .video:
            return "Watch the clip in the built-in player instead of throwing the file out to another app."
        case .pdf, .book:
            return "Read the file in the built-in reader so books and docs stay on the same shelf as the rest of the vault."
        case .folder:
            return "Browse the folder contents in one expanded shelf view without dropping out of RoachNet."
        case .generic:
            return "Preview books, media, markdown, and other vault files without leaving the RoachNet shell."
        }
    }

    var isInsideObsidianVault: Bool {
        var currentURL = url.deletingLastPathComponent()
        let fileManager = FileManager.default

        while currentURL.path != "/" {
            if fileManager.fileExists(atPath: currentURL.appendingPathComponent(".obsidian", isDirectory: true).path) {
                return true
            }
            currentURL.deleteLastPathComponent()
        }

        return false
    }
}

private struct NativeQuickLookPreview: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> QLPreviewView {
        let view = QLPreviewView(frame: .zero, style: .normal)!
        view.autostarts = true
        view.previewItem = url as NSURL
        return view
    }

    func updateNSView(_ view: QLPreviewView, context: Context) {
        view.previewItem = url as NSURL
    }
}

private struct NativeMediaPreview: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> AVPlayerView {
        let view = AVPlayerView(frame: .zero)
        view.player = AVPlayer(url: url)
        view.controlsStyle = .floating
        view.videoGravity = .resizeAspect
        return view
    }

    func updateNSView(_ view: AVPlayerView, context: Context) {
        if (view.player?.currentItem?.asset as? AVURLAsset)?.url != url {
            view.player = AVPlayer(url: url)
        }
    }

    static func dismantleNSView(_ view: AVPlayerView, coordinator: ()) {
        view.player?.pause()
        view.player = nil
    }
}

#if canImport(PDFKit)
private struct NativePDFPreview: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> PDFView {
        let view = PDFView(frame: .zero)
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displaysPageBreaks = false
        view.backgroundColor = .clear
        view.document = PDFDocument(url: url)
        return view
    }

    func updateNSView(_ view: PDFView, context: Context) {
        if view.document?.documentURL != url {
            view.document = PDFDocument(url: url)
        }
    }
}
#endif

private struct VaultRenderedMarkdownView: View {
    let markdown: String

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let attributed = try? AttributedString(markdown: markdown) {
                    Text(attributed)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    Text(markdown)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct VaultPreviewSurfaceView: View {
    let asset: PresentedVaultAsset
    let onClose: () -> Void

    @State private var markdownDraft = ""
    @State private var originalMarkdown = ""
    @State private var saveStatusLine: String?
    @State private var loadErrorLine: String?
    @State private var isSavingMarkdown = false
    @State private var folderChildren: [URL] = []

    private var hasUnsavedMarkdownChanges: Bool {
        asset.isMarkdown && markdownDraft != originalMarkdown
    }

    var body: some View {
        GeometryReader { proxy in
            let isTight = proxy.size.width < 1120

            ZStack {
                RoachBackground()

                VStack(spacing: 16) {
                    header

                    previewBody(isTight: isTight)
                }
                .padding(20)
            }
        }
        .task(id: asset.id) {
            await prepareAsset()
        }
    }

    private var header: some View {
        RoachInsetPanel {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 14) {
                    headerCopy
                    Spacer(minLength: 12)
                    headerActions
                }

                VStack(alignment: .leading, spacing: 14) {
                    headerCopy
                    headerActions
                }
            }
        }
    }

    private var headerCopy: some View {
        VStack(alignment: .leading, spacing: 8) {
            RoachSectionHeader(
                asset.previewHeadline,
                title: asset.title,
                detail: asset.previewDetail
            )

            Text(asset.subtitle)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundStyle(RoachPalette.muted)
                .lineLimit(2)
                .truncationMode(.middle)

            HStack(spacing: 8) {
                if asset.isMarkdown {
                    RoachTag("Editable note", accent: RoachPalette.magenta)
                }
                if asset.previewKind == .audio {
                    RoachTag("Music player", accent: RoachPalette.green)
                }
                if asset.previewKind == .video {
                    RoachTag("Video player", accent: RoachPalette.cyan)
                }
                if asset.previewKind == .pdf || asset.previewKind == .book {
                    RoachTag("Reader", accent: RoachPalette.bronze)
                }
                if asset.isDirectory {
                    RoachTag("Expanded shelf", accent: RoachPalette.cyan)
                }
                if asset.isInsideObsidianVault {
                    RoachTag("Shared with Obsidian", accent: RoachPalette.green)
                }
                if hasUnsavedMarkdownChanges {
                    RoachTag("Unsaved changes", accent: RoachPalette.warning)
                }
            }

            if let loadErrorLine {
                Text(loadErrorLine)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(RoachPalette.warning)
            } else if let saveStatusLine {
                Text(saveStatusLine)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(RoachPalette.muted)
            }
        }
    }

    private var headerActions: some View {
        HStack(spacing: 12) {
            Button("Reveal in Finder") {
                NSWorkspace.shared.activateFileViewerSelecting([asset.url])
            }
            .buttonStyle(RoachSecondaryButtonStyle())

            Button("Open Externally") {
                NSWorkspace.shared.open(asset.url)
            }
            .buttonStyle(RoachSecondaryButtonStyle())

            if asset.isMarkdown {
                Button(isSavingMarkdown ? "Saving..." : "Save Note") {
                    Task { await saveMarkdown() }
                }
                .buttonStyle(RoachPrimaryButtonStyle())
                .disabled(isSavingMarkdown || !hasUnsavedMarkdownChanges)
            }

            Button("Close") {
                onClose()
            }
            .buttonStyle(RoachSecondaryButtonStyle())
        }
    }

    @ViewBuilder
    private func previewBody(isTight: Bool) -> some View {
        switch asset.previewKind {
        case .markdown:
            markdownWorkspace(isTight: isTight)
        case .audio, .video:
            mediaWorkspace
        case .pdf:
            pdfWorkspace
        case .book:
            quickLookWorkspace
        case .folder:
            folderWorkspace
        case .generic:
            quickLookWorkspace
        }
    }

    @ViewBuilder
    private func markdownWorkspace(isTight: Bool) -> some View {
        if isTight {
            VStack(spacing: 16) {
                markdownEditorPanel
                markdownPreviewPanel
            }
        } else {
            HStack(alignment: .top, spacing: 16) {
                markdownEditorPanel
                    .frame(maxWidth: .infinity)
                markdownPreviewPanel
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private var mediaWorkspace: some View {
        RoachInsetPanel {
            VStack(alignment: .leading, spacing: 12) {
                RoachSectionHeader(
                    asset.previewKind == .audio ? "Player" : "Viewer",
                    title: asset.previewKind == .audio ? "Built-in listening lane." : "Built-in screening lane.",
                    detail: asset.previewKind == .audio
                        ? "Play the file here and keep the rest of the vault shelf within reach."
                        : "Watch the file here instead of jumping out to another player."
                )

                NativeMediaPreview(url: asset.url)
                    .frame(minHeight: 460)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .stroke(RoachPalette.border, lineWidth: 1)
                    )
            }
        }
    }

    private var quickLookWorkspace: some View {
        RoachInsetPanel {
            NativeQuickLookPreview(url: asset.url)
                .frame(minHeight: 560)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
    }

    private var pdfWorkspace: some View {
        RoachInsetPanel {
            VStack(alignment: .leading, spacing: 12) {
                RoachSectionHeader(
                    "Reader",
                    title: "Read without leaving the shelf.",
                    detail: "PDFs stay inside the vault reader instead of bouncing over to Preview."
                )

                #if canImport(PDFKit)
                NativePDFPreview(url: asset.url)
                    .frame(minHeight: 560)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .stroke(RoachPalette.border, lineWidth: 1)
                    )
                #else
                NativeQuickLookPreview(url: asset.url)
                    .frame(minHeight: 560)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                #endif
            }
        }
    }

    private var folderWorkspace: some View {
        RoachInsetPanel {
            VStack(alignment: .leading, spacing: 12) {
                RoachSectionHeader(
                    "Expanded Shelf",
                    title: "Browse the folder without leaving Vault.",
                    detail: folderChildren.isEmpty
                        ? "This folder is empty."
                        : "Peek into the folder contents here, then reveal the folder in Finder only when you actually need it."
                )

                if folderChildren.isEmpty {
                    Text("No files were found in this folder.")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(RoachPalette.muted)
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(folderChildren, id: \.path) { child in
                                HStack(alignment: .top, spacing: 12) {
                                    Image(systemName: child.hasDirectoryPath ? "folder.fill" : "doc.fill")
                                        .font(.system(size: 16, weight: .semibold))
                                        .foregroundStyle(child.hasDirectoryPath ? RoachPalette.cyan : RoachPalette.green)
                                        .frame(width: 18)

                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(child.lastPathComponent)
                                            .font(.system(size: 13, weight: .semibold))
                                            .foregroundStyle(RoachPalette.text)
                                        Text(child.path)
                                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                                            .foregroundStyle(RoachPalette.muted)
                                            .lineLimit(1)
                                            .truncationMode(.middle)
                                    }

                                    Spacer(minLength: 8)
                                }
                                .padding(12)
                                .background(
                                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                                        .fill(RoachPalette.panelRaised.opacity(0.72))
                                )
                                .overlay(
                                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                                        .stroke(RoachPalette.border, lineWidth: 1)
                                )
                            }
                        }
                    }
                    .frame(minHeight: 420)
                }
            }
        }
    }

    private var markdownEditorPanel: some View {
        RoachInsetPanel {
            VStack(alignment: .leading, spacing: 12) {
                RoachSectionHeader(
                    "Markdown",
                    title: "Write in the same file.",
                    detail: "This note stays on disk where Obsidian expects it. RoachNet edits the markdown directly instead of keeping a second copy."
                )

                TextEditor(text: $markdownDraft)
                    .font(.system(size: 13, weight: .medium, design: .monospaced))
                    .foregroundStyle(RoachPalette.text)
                    .scrollContentBackground(.hidden)
                    .padding(14)
                    .background(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(RoachPalette.panelRaised.opacity(0.92))
                            .overlay(
                                RoundedRectangle(cornerRadius: 18, style: .continuous)
                                    .stroke(RoachPalette.border, lineWidth: 1)
                            )
                    )
                    .frame(minHeight: 460)
            }
        }
    }

    private var markdownPreviewPanel: some View {
        RoachInsetPanel {
            VStack(alignment: .leading, spacing: 12) {
                RoachSectionHeader(
                    "Rendered",
                    title: "See the note like a reader.",
                    detail: "Quickly check headings, links, lists, and note flow without leaving the editor lane."
                )

                VaultRenderedMarkdownView(markdown: markdownDraft)
                    .frame(minHeight: 460)
                    .background(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(RoachPalette.panelRaised.opacity(0.76))
                            .overlay(
                                RoundedRectangle(cornerRadius: 18, style: .continuous)
                                    .stroke(RoachPalette.border, lineWidth: 1)
                            )
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
        }
    }

    private func loadMarkdown() async {
        do {
            let data = try Data(contentsOf: asset.url)
            let text = String(decoding: data, as: UTF8.self)
            markdownDraft = text
            originalMarkdown = text
            loadErrorLine = nil
            saveStatusLine = asset.isInsideObsidianVault
                ? "Live note link is open. RoachNet and Obsidian are reading the same file."
                : "Markdown note loaded from the vault."
        } catch {
            loadErrorLine = error.localizedDescription
            saveStatusLine = nil
        }
    }

    private func saveMarkdown() async {
        guard asset.isMarkdown else { return }

        isSavingMarkdown = true
        defer { isSavingMarkdown = false }

        do {
            try markdownDraft.write(to: asset.url, atomically: true, encoding: .utf8)
            originalMarkdown = markdownDraft
            loadErrorLine = nil
            saveStatusLine = asset.isInsideObsidianVault
                ? "Saved the note back into the shared Obsidian vault."
                : "Saved the note back into the RoachNet vault."
        } catch {
            loadErrorLine = error.localizedDescription
            saveStatusLine = nil
        }
    }

    private func prepareAsset() async {
        switch asset.previewKind {
        case .markdown:
            await loadMarkdown()
        case .folder:
            await loadFolderContents()
        default:
            break
        }
    }

    private func loadFolderContents() async {
        let contents = (try? FileManager.default.contentsOfDirectory(
            at: asset.url,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        )) ?? []

        folderChildren = contents
            .sorted { lhs, rhs in
                if lhs.hasDirectoryPath != rhs.hasDirectoryPath {
                    return lhs.hasDirectoryPath && !rhs.hasDirectoryPath
                }
                return lhs.lastPathComponent.localizedCaseInsensitiveCompare(rhs.lastPathComponent) == .orderedAscending
            }
            .prefix(24)
            .map { $0 }
    }
}
