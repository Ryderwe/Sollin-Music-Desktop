import AppKit
import Foundation

func usage() -> Never {
  fputs(
    """
    Usage:
      swift pad_icon.swift <input.png> <output.png> [canvasSize] [scale]

    Example:
      swift pad_icon.swift icon-master.png icon-master-padded.png 1024 0.88
    """,
    stderr
  )
  exit(2)
}

let args = CommandLine.arguments
guard args.count >= 3 else { usage() }

let inputPath = args[1]
let outputPath = args[2]
let canvasSize = Int(args.dropFirst(3).first ?? "1024") ?? 1024
let scale = Double(args.dropFirst(4).first ?? "0.88") ?? 0.88

guard canvasSize > 0, scale > 0, scale <= 1 else {
  fputs("Invalid canvasSize/scale.\n", stderr)
  exit(2)
}

let inputURL = URL(fileURLWithPath: inputPath)
guard let inputImage = NSImage(contentsOf: inputURL) else {
  fputs("Failed to read input image: \(inputPath)\n", stderr)
  exit(1)
}

guard let bitmap = NSBitmapImageRep(
  bitmapDataPlanes: nil,
  pixelsWide: canvasSize,
  pixelsHigh: canvasSize,
  bitsPerSample: 8,
  samplesPerPixel: 4,
  hasAlpha: true,
  isPlanar: false,
  colorSpaceName: .deviceRGB,
  bytesPerRow: 0,
  bitsPerPixel: 0
) else {
  fputs("Failed to create bitmap.\n", stderr)
  exit(1)
}

bitmap.size = NSSize(width: canvasSize, height: canvasSize)

guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
  fputs("Failed to create graphics context.\n", stderr)
  exit(1)
}

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
context.imageInterpolation = .high
context.shouldAntialias = true

NSColor.clear.setFill()
NSRect(x: 0, y: 0, width: canvasSize, height: canvasSize).fill()

let targetSide = CGFloat(Double(canvasSize) * scale)
let origin = (CGFloat(canvasSize) - targetSide) / 2.0
let targetRect = NSRect(x: origin, y: origin, width: targetSide, height: targetSide)

inputImage.draw(
  in: targetRect,
  from: NSRect(origin: .zero, size: inputImage.size),
  operation: .sourceOver,
  fraction: 1.0,
  respectFlipped: true,
  hints: [.interpolation: NSImageInterpolation.high]
)

NSGraphicsContext.restoreGraphicsState()

guard let pngData = bitmap.representation(using: .png, properties: [:]) else {
  fputs("Failed to encode PNG.\n", stderr)
  exit(1)
}

do {
  try pngData.write(to: URL(fileURLWithPath: outputPath), options: [.atomic])
} catch {
  fputs("Failed to write output image: \(outputPath)\n\(error)\n", stderr)
  exit(1)
}

