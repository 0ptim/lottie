import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import CanvasKitInit from "canvaskit-wasm/full";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function usage() {
  console.log(`Usage: bun run render:frame [options]

Options:
  --frame <n>       Frame to render. Defaults to 0.
  --input <path>    Lottie JSON path. Defaults to public/lottie.json.
  --out <path>      PNG output path. Defaults to tmp/lottie-frame-<frame>.png.
  --scale <n>       Output scale multiplier. Defaults to 1.
`);
}

function readArgs(argv) {
  const options = {
    frame: 0,
    input: "public/lottie.json",
    out: null,
    scale: 1,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];

    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }

    if (!arg.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    i += 1;
    if (arg === "--frame") options.frame = Number(value);
    else if (arg === "--input") options.input = value;
    else if (arg === "--out") options.out = value;
    else if (arg === "--scale") options.scale = Number(value);
    else throw new Error(`Unknown option ${arg}`);
  }

  if (!Number.isFinite(options.frame) || options.frame < 0) {
    throw new Error("--frame must be a non-negative number");
  }
  if (!Number.isFinite(options.scale) || options.scale <= 0) {
    throw new Error("--scale must be a positive number");
  }

  options.out ??= `tmp/lottie-frame-${Math.round(options.frame)}.png`;
  return options;
}

function countPixelStats(pixels) {
  let alphaPixels = 0;
  const colors = new Set();

  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3];
    if (alpha > 0) alphaPixels += 1;
    if (colors.size < 257) {
      colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]},${alpha}`);
    }
  }

  return {
    alphaPixels,
    uniqueColors: colors.size,
  };
}

const options = readArgs(process.argv.slice(2));
const inputPath = resolve(root, options.input);
const outputPath = resolve(root, options.out);
const wasmPath = resolve(root, "public/canvaskit.wasm");

const [CanvasKit, lottieJson] = await Promise.all([
  CanvasKitInit({ locateFile: () => wasmPath }),
  readFile(inputPath, "utf8"),
]);

const animation = CanvasKit.MakeManagedAnimation(lottieJson);
if (!animation) {
  throw new Error(`CanvasKit could not parse ${options.input}`);
}

const [animationWidth, animationHeight] = animation.size();
const width = Math.max(1, Math.ceil(animationWidth * options.scale));
const height = Math.max(1, Math.ceil(animationHeight * options.scale));
const surface = CanvasKit.MakeSurface(width, height);

if (!surface) {
  animation.delete();
  throw new Error(`Could not create ${width}x${height} render surface`);
}

const canvas = surface.getCanvas();
canvas.clear(CanvasKit.TRANSPARENT);
animation.seekFrame(options.frame);
animation.render(canvas, CanvasKit.LTRBRect(0, 0, width, height));
surface.flush();

const image = surface.makeImageSnapshot();
const png = image.encodeToBytes();
const pixels = canvas.readPixels(0, 0, {
  width,
  height,
  colorType: CanvasKit.ColorType.RGBA_8888,
  alphaType: CanvasKit.AlphaType.Unpremul,
  colorSpace: CanvasKit.ColorSpace.SRGB,
});

if (!png || !pixels) {
  image.delete();
  surface.delete();
  animation.delete();
  throw new Error("CanvasKit failed to encode or read the rendered frame");
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, Buffer.from(png));

const stats = countPixelStats(pixels);
console.log(
  JSON.stringify(
    {
      input: options.input,
      output: options.out,
      frame: options.frame,
      width,
      height,
      pngBytes: png.length,
      alphaPixels: stats.alphaPixels,
      uniqueColors: stats.uniqueColors,
    },
    null,
    2
  )
);

image.delete();
surface.delete();
animation.delete();
