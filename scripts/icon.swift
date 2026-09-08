// Local personalization: keep the application icon identical to installed EVE.
import AppKit
let source = URL(fileURLWithPath: "/Applications/Eve Recorder.app/Contents/Resources/icon.icns")
let destination = URL(fileURLWithPath: "src/icon.icns")
try Data(contentsOf: source).write(to: destination)
let image = NSImage(contentsOf: source)!
let rep = NSBitmapImageRep(data: image.tiffRepresentation!)!
try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "src/icon.png"))
