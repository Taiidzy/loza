//
//  LozaApp.swift
//  Loza
//
//  Native mobile entry point. Equivalent to main.tsx mounting <App />,
//  but there's no titlebar/window-chrome branch here since that part
//  of App.tsx was explicitly desktop-only (Tauri window controls) and
//  out of scope for this port.
//

import SwiftUI

@main
struct LozaApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                .preferredInterfaceStyle(.dark)
        }
    }
}
