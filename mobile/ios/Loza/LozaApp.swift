//
//  LozaApp.swift
//  Loza
//
//  Native mobile entry point. Equivalent to main.tsx mounting <App />.
//

import SwiftUI

@main
struct LozaApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                .preferredColorScheme(.dark)
        }
    }
}
