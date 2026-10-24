import Foundation
import Vision
import AppKit

// Usage: vision-ocr <image-path>
// Prints recognised text, one line per detected line, top-to-bottom.

guard CommandLine.arguments.count > 1 else {
    FileHandle.standardError.write("usage: vision-ocr <image>\n".data(using: .utf8)!)
    exit(2)
}

let path = CommandLine.arguments[1]
guard let image = NSImage(contentsOfFile: path),
      let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let cg = bitmap.cgImage else {
    FileHandle.standardError.write("cannot read image: \(path)\n".data(using: .utf8)!)
    exit(3)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["en-US"]

let handler = VNImageRequestHandler(cgImage: cg, options: [:])
do {
    try handler.perform([request])
} catch {
    FileHandle.standardError.write("vision failed: \(error)\n".data(using: .utf8)!)
    exit(4)
}

guard let results = request.results else { exit(0) }

// Sort top-to-bottom, then left-to-right. Vision origin is bottom-left.
struct Line { let text: String; let y: Double; let x: Double }
var lines: [Line] = []
for obs in results {
    guard let best = obs.topCandidates(1).first else { continue }
    lines.append(Line(text: best.string,
                      y: Double(obs.boundingBox.origin.y),
                      x: Double(obs.boundingBox.origin.x)))
}
lines.sort { a, b in
    if abs(a.y - b.y) > 0.01 { return a.y > b.y }
    return a.x < b.x
}
print(lines.map { $0.text }.joined(separator: "\n"))
