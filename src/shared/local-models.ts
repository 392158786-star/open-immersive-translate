export interface LocalModelDescriptor {
  id: string;
  label: string;
  description: string;
  sizeHint: string;
  device: "wasm" | "webgpu";
}

export const LOCAL_TRANSLATION_MODELS: readonly LocalModelDescriptor[] = [
  {
    id: "Xenova/opus-mt-en-zh",
    label: "英中轻量模型",
    description: "默认稳定方案，适合浏览器 WASM 环境。",
    sizeHint: "约 150 MB",
    device: "wasm",
  },
  {
    id: "Xenova/m2m100_418M",
    label: "多语种平衡模型",
    description: "覆盖更多语言，建议使用 WebGPU。",
    sizeHint: "约 500 MB",
    device: "webgpu",
  },
  {
    id: "Xenova/nllb-200-distilled-600M",
    label: "多语种高质量模型",
    description: "语言覆盖广，但需要更多内存，建议 WebGPU。",
    sizeHint: "约 1.2 GB",
    device: "webgpu",
  },
];

export const LOCAL_ACADEMIC_MODELS: readonly LocalModelDescriptor[] = [
  {
    id: "onnx-community/Qwen2.5-0.5B-Instruct",
    label: "轻量学术模型",
    description: "默认稳定方案，适合本地术语解释和短对话。",
    sizeHint: "约 400 MB",
    device: "wasm",
  },
  {
    id: "onnx-community/Qwen2.5-1.5B-Instruct",
    label: "高质量学术模型",
    description: "回答质量更高，建议使用 WebGPU 和更多内存。",
    sizeHint: "约 1.2 GB",
    device: "webgpu",
  },
];

export const DEFAULT_LOCAL_TRANSLATION_MODEL =
  LOCAL_TRANSLATION_MODELS[0]!.id;
export const DEFAULT_LOCAL_ACADEMIC_MODEL = LOCAL_ACADEMIC_MODELS[0]!.id;
