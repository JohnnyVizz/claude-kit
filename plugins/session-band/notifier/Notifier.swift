// Posts one system notification under this app's name and icon, and opens the URL
// it carries when the notification is clicked.
//
//   session-band-notifier -title T -message M [-open URL] [-group ID]
//
// Exits 0 once the notification is posted, 2 when notifications are not allowed,
// 1 when posting failed, 64 on bad usage. A later notification with the same group
// replaces the earlier one. Clicked after this process exited, the system launches
// the app again with no arguments: it opens that notification's URL and quits.

import AppKit
import UserNotifications

final class Delegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
  let options: [String: String]

  init(options: [String: String]) {
    self.options = options
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    let center = UNUserNotificationCenter.current()
    center.delegate = self

    guard let title = options["title"], let message = options["message"] else {
      if !options.isEmpty { exit(64) }
      // Launched by a click: the response arrives next; quit if it never does.
      DispatchQueue.main.asyncAfter(deadline: .now() + 10) { exit(0) }
      return
    }

    center.requestAuthorization(options: [.alert, .sound]) { isGranted, _ in
      guard isGranted else { exit(2) }

      let content = UNMutableNotificationContent()
      content.title = title
      content.body = message
      content.sound = .default
      if let url = self.options["open"] { content.userInfo = ["url": url] }

      let id = self.options["group"] ?? UUID().uuidString
      center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil)) { error in
        exit(error == nil ? 0 : 1)
      }
    }
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler done: @escaping () -> Void
  ) {
    if response.actionIdentifier == UNNotificationDefaultActionIdentifier,
      let link = response.notification.request.content.userInfo["url"] as? String,
      let url = URL(string: link)
    {
      NSWorkspace.shared.open(url)
    }
    done()
    exit(0)
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    done([.banner, .sound])
  }
}

// `-key value` pairs; a launch by a click has none.
var options: [String: String] = [:]
var args = CommandLine.arguments.dropFirst().makeIterator()
while let key = args.next() {
  guard key.hasPrefix("-"), let value = args.next() else { exit(64) }
  options[String(key.dropFirst())] = value
}

let app = NSApplication.shared
let delegate = Delegate(options: options)
app.delegate = delegate
app.run()
