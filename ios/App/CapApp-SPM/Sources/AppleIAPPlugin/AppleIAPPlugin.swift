import Foundation
import Capacitor
import StoreKit
import UIKit

@objc(AppleIAPPlugin)
public class AppleIAPPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppleIAPPlugin"
    public let jsName = "AppleIAP"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "currentEntitlements", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unfinishedTransactions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restorePurchases", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "manageSubscriptions", returnType: CAPPluginReturnPromise)
    ]

    private func productIdentifiers(_ call: CAPPluginCall) -> Set<String> {
        Set(call.getArray("productIds", String.self) ?? [])
    }

    private func subscriptionPeriod(_ product: Product) -> JSObject? {
        guard let period = product.subscription?.subscriptionPeriod else { return nil }
        let unit: String
        switch period.unit {
        case .day: unit = "day"
        case .week: unit = "week"
        case .month: unit = "month"
        case .year: unit = "year"
        @unknown default: unit = "unknown"
        }
        return ["value": period.value, "unit": unit]
    }

    private func productType(_ product: Product) -> String {
        switch product.type {
        case .autoRenewable: return "auto-renewable-subscription"
        case .consumable: return "consumable"
        case .nonConsumable: return "non-consumable"
        case .nonRenewable: return "non-renewing-subscription"
        default: return "unknown"
        }
    }

    private func productPayload(_ product: Product) -> JSObject {
        var payload: JSObject = [
            "id": product.id,
            "displayName": product.displayName,
            "description": product.description,
            "displayPrice": product.displayPrice,
            "price": NSDecimalNumber(decimal: product.price).stringValue,
            "type": productType(product)
        ]
        if let period = subscriptionPeriod(product) { payload["subscriptionPeriod"] = period }
        return payload
    }

    private func transactionPayload(_ result: VerificationResult<Transaction>) throws -> JSObject {
        switch result {
        case .verified(let transaction):
            var payload: JSObject = [
                "status": "verified",
                "transactionId": String(transaction.id),
                "originalTransactionId": String(transaction.originalID),
                "productId": transaction.productID,
                "signedTransaction": result.jwsRepresentation
            ]
            if let token = transaction.appAccountToken { payload["appAccountToken"] = token.uuidString.lowercased() }
            if let expirationDate = transaction.expirationDate { payload["expiresAt"] = expirationDate.iso8601Format() }
            return payload
        case .unverified(_, let error):
            throw error
        }
    }

    @objc func getProducts(_ call: CAPPluginCall) {
        let identifiers = productIdentifiers(call)
        guard !identifiers.isEmpty else { call.reject("At least one Apple product identifier is required."); return }
        Task {
            do {
                let products = try await Product.products(for: identifiers).sorted { $0.id < $1.id }
                call.resolve(["products": products.map(productPayload)])
            } catch {
                call.reject("Apple products could not be loaded.", nil, error)
            }
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId"), !productId.isEmpty else { call.reject("An Apple product identifier is required."); return }
        guard let rawToken = call.getString("appAccountToken"), let accountToken = UUID(uuidString: rawToken) else { call.reject("A valid Apple account token is required."); return }
        Task {
            do {
                guard let product = try await Product.products(for: [productId]).first else { call.reject("This Apple product is not available."); return }
                let result = try await product.purchase(options: [.appAccountToken(accountToken)])
                switch result {
                case .success(let verification): call.resolve(try transactionPayload(verification))
                case .pending: call.resolve(["status": "pending"])
                case .userCancelled: call.resolve(["status": "cancelled"])
                @unknown default: call.resolve(["status": "unknown"])
                }
            } catch {
                call.reject("The Apple purchase could not be completed.", nil, error)
            }
        }
    }

    @objc func currentEntitlements(_ call: CAPPluginCall) {
        let identifiers = productIdentifiers(call)
        Task {
            var transactions: [JSObject] = []
            do {
                for await result in Transaction.currentEntitlements {
                    guard case .verified(let transaction) = result, identifiers.isEmpty || identifiers.contains(transaction.productID) else { continue }
                    transactions.append(try transactionPayload(result))
                }
                call.resolve(["transactions": transactions])
            } catch {
                call.reject("Apple purchases could not be checked.", nil, error)
            }
        }
    }

    @objc func unfinishedTransactions(_ call: CAPPluginCall) {
        let identifiers = productIdentifiers(call)
        Task {
            var transactions: [JSObject] = []
            do {
                for await result in Transaction.unfinished {
                    guard case .verified(let transaction) = result, identifiers.isEmpty || identifiers.contains(transaction.productID) else { continue }
                    transactions.append(try transactionPayload(result))
                }
                call.resolve(["transactions": transactions])
            } catch {
                call.reject("Unfinished Apple purchases could not be checked.", nil, error)
            }
        }
    }

    @objc func finish(_ call: CAPPluginCall) {
        guard let transactionId = call.getString("transactionId"), !transactionId.isEmpty else { call.reject("An Apple transaction identifier is required."); return }
        Task {
            for await result in Transaction.unfinished {
                guard case .verified(let transaction) = result, String(transaction.id) == transactionId else { continue }
                await transaction.finish()
                call.resolve(["finished": true])
                return
            }
            call.resolve(["finished": false])
        }
    }

    @objc func restorePurchases(_ call: CAPPluginCall) {
        let identifiers = productIdentifiers(call)
        Task {
            do {
                try await AppStore.sync()
                var transactions: [JSObject] = []
                for await result in Transaction.currentEntitlements {
                    guard case .verified(let transaction) = result, identifiers.isEmpty || identifiers.contains(transaction.productID) else { continue }
                    transactions.append(try transactionPayload(result))
                }
                call.resolve(["transactions": transactions])
            } catch {
                call.reject("Apple purchases could not be restored.", nil, error)
            }
        }
    }

    @objc func manageSubscriptions(_ call: CAPPluginCall) {
        Task { @MainActor in
            do {
                guard let windowScene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first(where: { $0.activationState == .foregroundActive }) else {
                    call.reject("The Apple subscription screen is not available right now.")
                    return
                }
                try await AppStore.showManageSubscriptions(in: windowScene)
                call.resolve(["opened": true])
            } catch {
                call.reject("Apple subscription settings could not be opened.", nil, error)
            }
        }
    }
}
