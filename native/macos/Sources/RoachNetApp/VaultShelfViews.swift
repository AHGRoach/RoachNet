import AppKit
import QuickLookThumbnailing
import SwiftUI
import RoachNetDesign

@MainActor
private final class VaultThumbnailModel: ObservableObject {
    @Published var image: NSImage?

    init(url: URL, size: CGSize) {
        Task { await loadThumbnail(for: url, size: size) }
    }

    private func loadThumbnail(for url: URL, size: CGSize) async {
        let request = QLThumbnailGenerator.Request(
            fileAt: url,
            size: size,
            scale: NSScreen.main?.backingScaleFactor ?? 2,
            representationTypes: .all
        )

        do {
            let representation = try await QLThumbnailGenerator.shared.generateBestRepresentation(for: request)
            image = representation.nsImage
        } catch {
            image = nil
        }
    }
}

private struct VaultThumbnailView: View {
    let url: URL
    let accent: Color
    let fallbackSystemName: String
    let idlePhase: Bool
    let isHovered: Bool

    @StateObject private var thumbnailModel: VaultThumbnailModel

    init(
        url: URL,
        accent: Color,
        fallbackSystemName: String,
        idlePhase: Bool,
        isHovered: Bool
    ) {
        self.url = url
        self.accent = accent
        self.fallbackSystemName = fallbackSystemName
        self.idlePhase = idlePhase
        self.isHovered = isHovered
        _thumbnailModel = StateObject(
            wrappedValue: VaultThumbnailModel(url: url, size: CGSize(width: 220, height: 220))
        )
    }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(accent.opacity(0.18))

            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(accent.opacity(isHovered ? 0.55 : 0.28), lineWidth: 1.2)

            if let image = thumbnailModel.image {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .scaleEffect(isHovered ? 1.08 : 1.02)
                    .overlay(
                        LinearGradient(
                            colors: [
                                Color.black.opacity(0.0),
                                Color.black.opacity(0.12),
                                Color.black.opacity(0.22),
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
            } else {
                Image(systemName: fallbackSystemName)
                    .font(.system(size: 30, weight: .bold))
                    .foregroundStyle(accent)
                    .rotationEffect(.degrees(isHovered ? -6 : (idlePhase ? -3 : 3)))
                    .scaleEffect(isHovered ? 1.1 : 1.0)
            }
        }
        .shadow(color: accent.opacity(isHovered ? 0.34 : 0.16), radius: isHovered ? 18 : 10, y: 10)
        .rotationEffect(.degrees(isHovered ? -1.5 : (idlePhase ? -0.7 : 0.7)))
        .offset(y: isHovered ? -3 : (idlePhase ? -1.5 : 1.5))
        .animation(.easeInOut(duration: 2.6).repeatForever(autoreverses: true), value: idlePhase)
        .animation(.spring(response: 0.26, dampingFraction: 0.82), value: isHovered)
    }
}

private struct VaultGlyphTileView: View {
    let accent: Color
    let fallbackSystemName: String
    let idlePhase: Bool
    let isHovered: Bool

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(accent.opacity(0.18))

            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(accent.opacity(isHovered ? 0.55 : 0.28), lineWidth: 1.2)

            Circle()
                .fill(accent.opacity(isHovered ? 0.24 : 0.16))
                .blur(radius: isHovered ? 26 : 18)
                .scaleEffect(isHovered ? 1.12 : (idlePhase ? 1.04 : 0.98))

            Image(systemName: fallbackSystemName)
                .font(.system(size: 34, weight: .bold))
                .foregroundStyle(accent)
                .rotationEffect(.degrees(isHovered ? -8 : (idlePhase ? -4 : 4)))
                .scaleEffect(isHovered ? 1.12 : 1.0)
                .shadow(color: accent.opacity(isHovered ? 0.44 : 0.22), radius: isHovered ? 18 : 10, y: 8)
        }
        .shadow(color: accent.opacity(isHovered ? 0.34 : 0.16), radius: isHovered ? 18 : 10, y: 10)
        .rotationEffect(.degrees(isHovered ? -1.5 : (idlePhase ? -0.7 : 0.7)))
        .offset(y: isHovered ? -3 : (idlePhase ? -1.5 : 1.5))
        .animation(.easeInOut(duration: 2.6).repeatForever(autoreverses: true), value: idlePhase)
        .animation(.spring(response: 0.26, dampingFraction: 0.82), value: isHovered)
    }
}

struct VaultShelfCard: View {
    let url: URL
    let title: String
    let detail: String
    let pathLabel: String
    let kindLabel: String
    let actionLabel: String
    let accent: Color
    let fallbackSystemName: String
    let extraTags: [String]

    @State private var isHovered = false
    @State private var idlePhase = false

    var body: some View {
        RoachInsetPanel {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    RoachTag(kindLabel, accent: accent)
                    Spacer(minLength: 8)
                    Text(actionLabel)
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .tracking(1.0)
                        .foregroundStyle(accent)
                }

                VaultThumbnailView(
                    url: url,
                    accent: accent,
                    fallbackSystemName: fallbackSystemName,
                    idlePhase: idlePhase,
                    isHovered: isHovered
                )
                .frame(height: 168)

                VStack(alignment: .leading, spacing: 6) {
                    Text(title)
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                        .foregroundStyle(RoachPalette.text)
                        .lineLimit(2)

                    Text(detail)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(RoachPalette.muted)
                        .lineLimit(3)

                    Text(pathLabel)
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundStyle(RoachPalette.muted)
                        .lineLimit(2)
                }

                if !extraTags.isEmpty {
                    HStack(spacing: 8) {
                        ForEach(extraTags, id: \.self) { tag in
                            RoachTag(tag, accent: accent)
                        }
                    }
                }
            }
        }
        .scaleEffect(isHovered ? 1.018 : 1.0)
        .onHover { hovered in
            withAnimation(.spring(response: 0.24, dampingFraction: 0.84)) {
                isHovered = hovered
            }
        }
        .onAppear {
            idlePhase = true
        }
    }
}

struct VaultVirtualShelfCard: View {
    let title: String
    let detail: String
    let pathLabel: String
    let kindLabel: String
    let actionLabel: String
    let accent: Color
    let fallbackSystemName: String
    let extraTags: [String]

    @State private var isHovered = false
    @State private var idlePhase = false

    var body: some View {
        RoachInsetPanel {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    RoachTag(kindLabel, accent: accent)
                    Spacer(minLength: 8)
                    Text(actionLabel)
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .tracking(1.0)
                        .foregroundStyle(accent)
                }

                VaultGlyphTileView(
                    accent: accent,
                    fallbackSystemName: fallbackSystemName,
                    idlePhase: idlePhase,
                    isHovered: isHovered
                )
                .frame(height: 168)

                VStack(alignment: .leading, spacing: 6) {
                    Text(title)
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                        .foregroundStyle(RoachPalette.text)
                        .lineLimit(2)

                    Text(detail)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(RoachPalette.muted)
                        .lineLimit(3)

                    Text(pathLabel)
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundStyle(RoachPalette.muted)
                        .lineLimit(2)
                }

                if !extraTags.isEmpty {
                    HStack(spacing: 8) {
                        ForEach(extraTags, id: \.self) { tag in
                            RoachTag(tag, accent: accent)
                        }
                    }
                }
            }
        }
        .scaleEffect(isHovered ? 1.018 : 1.0)
        .onHover { hovered in
            withAnimation(.spring(response: 0.24, dampingFraction: 0.84)) {
                isHovered = hovered
            }
        }
        .onAppear {
            idlePhase = true
        }
    }
}
