import CryptoKit
import Foundation
import Security

public struct RoachNetSecretRecord: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var label: String
    public var key: String
    public var scope: String
    public var notes: String
    public var createdAt: String
    public var updatedAt: String

    public init(
        id: String,
        label: String,
        key: String,
        scope: String,
        notes: String,
        createdAt: String,
        updatedAt: String
    ) {
        self.id = id
        self.label = label
        self.key = key
        self.scope = scope
        self.notes = notes
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct RoachNetSecretTemplate: Identifiable, Hashable, Sendable {
    public let id: String
    public let label: String
    public let key: String
    public let scope: String
    public let notes: String

    public init(id: String, label: String, key: String, scope: String, notes: String) {
        self.id = id
        self.label = label
        self.key = key
        self.scope = scope
        self.notes = notes
    }
}

public enum RoachNetDeveloperPaths {
    public static func workspaceRoot(storagePath: String) -> String {
        URL(fileURLWithPath: storagePath)
            .appendingPathComponent("vault", isDirectory: true)
            .path
    }

    public static func projectsRoot(storagePath: String) -> String {
        URL(fileURLWithPath: workspaceRoot(storagePath: storagePath))
            .appendingPathComponent("projects", isDirectory: true)
            .path
    }

    public static func stateRoot(storagePath: String) -> String {
        URL(fileURLWithPath: workspaceRoot(storagePath: storagePath))
            .appendingPathComponent("secrets", isDirectory: true)
            .path
    }

    public static func secretsCatalogURL(storagePath: String) -> URL {
        URL(fileURLWithPath: stateRoot(storagePath: storagePath))
            .appendingPathComponent("manifest.json")
    }

    public static func ensureWorkspaceDirectories(storagePath: String) throws {
        let fileManager = FileManager.default
        try fileManager.createDirectory(
            at: URL(fileURLWithPath: projectsRoot(storagePath: storagePath)),
            withIntermediateDirectories: true
        )
        try fileManager.createDirectory(
            at: secretsCatalogURL(storagePath: storagePath).deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
    }
}

public enum RoachNetSecretsCatalogStore {
    public static let suggestedTemplates: [RoachNetSecretTemplate] = [
        .init(
            id: "openai-api-key",
            label: "OpenAI API Key",
            key: "OPENAI_API_KEY",
            scope: "AI / Cloud lane",
            notes: "Remote coding and fallback model access for RoachClaw and future dev-assist flows."
        ),
        .init(
            id: "openrouter-api-key",
            label: "OpenRouter API Key",
            key: "OPENROUTER_API_KEY",
            scope: "AI / Cloud lane",
            notes: "Optional multi-provider cloud lane for first-boot fallback and model routing."
        ),
        .init(
            id: "anthropic-api-key",
            label: "Anthropic API Key",
            key: "ANTHROPIC_API_KEY",
            scope: "AI / Cloud lane",
            notes: "Optional remote coding lane when a local model is unavailable or too slow."
        ),
        .init(
            id: "infisical-client-id",
            label: "Infisical Client ID",
            key: "INFISICAL_CLIENT_ID",
            scope: "Secrets / Sync",
            notes: "Optional machine or service identity for syncing RoachNet metadata with Infisical."
        ),
        .init(
            id: "infisical-client-secret",
            label: "Infisical Client Secret",
            key: "INFISICAL_CLIENT_SECRET",
            scope: "Secrets / Sync",
            notes: "Pairs with Infisical client ID when enabling hosted secret sync later."
        ),
        .init(
            id: "github-token",
            label: "GitHub Token",
            key: "GITHUB_TOKEN",
            scope: "Dev tools",
            notes: "Used for repo operations, release tooling, and future in-app code assistance."
        ),
        .init(
            id: "hugging-face-token",
            label: "Hugging Face Token",
            key: "HUGGINGFACE_TOKEN",
            scope: "AI / Models",
            notes: "Lets RoachNet pull gated model metadata, Spaces, and future Hub-backed coding or ML workflows."
        ),
        .init(
            id: "netlify-auth-token",
            label: "Netlify Auth Token",
            key: "NETLIFY_AUTH_TOKEN",
            scope: "Deployments",
            notes: "Used for site deploys and App Store/catalog publishing lanes."
        ),
        .init(
            id: "netlify-site-id",
            label: "Netlify Site ID",
            key: "NETLIFY_SITE_ID",
            scope: "Deployments",
            notes: "Optional target selector for roachnet.org deploy workflows."
        ),
        .init(
            id: "netlify-apps-site-id",
            label: "Netlify Apps Site ID",
            key: "NETLIFY_APPS_SITE_ID",
            scope: "Deployments",
            notes: "Optional target selector for the apps.roachnet.org App Store deployment lane."
        ),
        .init(
            id: "cloudflare-api-token",
            label: "Cloudflare API Token",
            key: "CLOUDFLARE_API_TOKEN",
            scope: "Edge / Infra",
            notes: "Useful for DNS, edge routing, and future RoachNet edge workflows without storing the token in dotfiles."
        ),
        .init(
            id: "cloudflare-account-id",
            label: "Cloudflare Account ID",
            key: "CLOUDFLARE_ACCOUNT_ID",
            scope: "Edge / Infra",
            notes: "Pairs with the Cloudflare API token when the project needs Workers, DNS, or storage automation."
        ),
        .init(
            id: "paypal-client-id",
            label: "PayPal Client ID",
            key: "PAYPAL_CLIENT_ID",
            scope: "Payments",
            notes: "Keeps donation or checkout surfaces configurable without leaving payment credentials in workspace files."
        ),
    ]

    public static func load(storagePath: String) -> [RoachNetSecretRecord] {
        let url = RoachNetDeveloperPaths.secretsCatalogURL(storagePath: storagePath)
        guard
            let data = try? Data(contentsOf: url),
            let decoded = try? JSONDecoder().decode([RoachNetSecretRecord].self, from: data)
        else {
            return []
        }

        return decoded.sorted { lhs, rhs in
            lhs.label.localizedCaseInsensitiveCompare(rhs.label) == .orderedAscending
        }
    }

    public static func save(_ records: [RoachNetSecretRecord], storagePath: String) throws {
        try RoachNetDeveloperPaths.ensureWorkspaceDirectories(storagePath: storagePath)
        let url = RoachNetDeveloperPaths.secretsCatalogURL(storagePath: storagePath)
        let data = try JSONEncoder.pretty.encode(records.sorted {
            $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending
        })
        try data.write(to: url, options: [.atomic])
    }
}

public enum RoachNetKeychainSecretStore {
    public static func secretExists(id: String, installPath: String) -> Bool {
        (try? secretValue(id: id, installPath: installPath)) != nil
    }

    public static func secretValue(id: String, installPath: String) throws -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName(for: installPath),
            kSecAttrAccount as String: id,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)

        switch status {
        case errSecSuccess:
            guard let data = item as? Data else { return nil }
            return String(data: data, encoding: .utf8)
        case errSecItemNotFound:
            return nil
        default:
            throw keychainError(status)
        }
    }

    public static func setSecretValue(_ value: String, id: String, installPath: String) throws {
        let service = serviceName(for: installPath)
        let data = Data(value.utf8)

        let baseQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: id,
        ]

        let updateFields: [String: Any] = [
            kSecValueData as String: data,
        ]

        let updateStatus = SecItemUpdate(baseQuery as CFDictionary, updateFields as CFDictionary)
        if updateStatus == errSecSuccess {
            return
        }

        if updateStatus != errSecItemNotFound {
            throw keychainError(updateStatus)
        }

        var createQuery = baseQuery
        createQuery[kSecValueData as String] = data
        createQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock

        let createStatus = SecItemAdd(createQuery as CFDictionary, nil)
        guard createStatus == errSecSuccess else {
            throw keychainError(createStatus)
        }
    }

    public static func deleteSecret(id: String, installPath: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName(for: installPath),
            kSecAttrAccount as String: id,
        ]

        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw keychainError(status)
        }
    }

    private static func serviceName(for installPath: String) -> String {
        let normalizedPath = URL(fileURLWithPath: installPath).standardizedFileURL.path
        let digest = SHA256.hash(data: Data(normalizedPath.utf8))
        let suffix = digest.compactMap { String(format: "%02x", $0) }.joined().prefix(16)
        return "com.roachnet.secret.\(suffix)"
    }

    private static func keychainError(_ status: OSStatus) -> NSError {
        let message = SecCopyErrorMessageString(status, nil) as String? ?? "Keychain failure (\(status))"
        return NSError(
            domain: "RoachNetKeychain",
            code: Int(status),
            userInfo: [NSLocalizedDescriptionKey: message]
        )
    }
}
