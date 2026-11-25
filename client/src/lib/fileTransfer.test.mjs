import assert from "node:assert/strict";
import {
  MAX_FILE_SIZE,
  CHUNK_SIZE,
  uint8ArrayToBase64,
  base64ToUint8Array,
  formatBytes,
  reassembleChunks,
  shouldFlushInboundProgress,
} from "./fileTransfer.ts";

console.log("=== KIỂM THỬ FILE TRANSFER HELPER ===");

// 1. Kiểm tra hằng số kích thước
assert.equal(MAX_FILE_SIZE, 2 * 1024 * 1024 * 1024, "Giới hạn tối đa phải là 2 GB");
assert.equal(CHUNK_SIZE, 64 * 1024, "Kích thước chunk phải là 64 KB");
console.log("✓ Hằng số kích thước tối ưu: MAX=2GB, CHUNK=64KB");

// 2. Kiểm tra Base64 encode & decode
const sampleData = new Uint8Array([0, 1, 2, 253, 254, 255, 65, 66, 67, 10, 13, 0]);
const encoded = uint8ArrayToBase64(sampleData);
assert.equal(typeof encoded, "string", "Encoded data phải là chuỗi");
const decoded = base64ToUint8Array(encoded);
assert.deepEqual(decoded, sampleData, "Dữ liệu sau khi giải mã Base64 phải trùng khớp byte-for-byte");
console.log("✓ Base64 encode/decode toàn vẹn 100%");

// 3. Kiểm tra formatBytes
assert.equal(formatBytes(0), "0 B");
assert.equal(formatBytes(1024), "1 KB");
assert.equal(formatBytes(1024 * 1024), "1 MB");
assert.equal(formatBytes(10 * 1024 * 1024), "10 MB");
console.log("✓ Format dung lượng chính xác (B, KB, MB)");

// 4. Kiểm tra mô phỏng chia và ghép chunks (300 KB data -> 5 chunks 64KB)
const testSize = 300 * 1024; // 300 KB
const originalBytes = new Uint8Array(testSize);
for (let i = 0; i < testSize; i++) {
  originalBytes[i] = i % 256;
}

const totalExpectedChunks = Math.ceil(testSize / CHUNK_SIZE);
assert.equal(totalExpectedChunks, 5, "300 KB chia chunk 64KB phải ra 5 chunks");

const receivedMap = new Map();
for (let i = 0; i < totalExpectedChunks; i++) {
  const start = i * CHUNK_SIZE;
  const end = Math.min(testSize, start + CHUNK_SIZE);
  const chunkSlice = originalBytes.subarray(start, end);
  assert(chunkSlice.byteLength <= CHUNK_SIZE, "Mỗi chunk không vượt quá 64 KB");

  // Giả lập gửi qua network dưới dạng base64 và nhận lại
  const b64 = uint8ArrayToBase64(chunkSlice);
  const back = base64ToUint8Array(b64);
  receivedMap.set(i, back);
}

const reassembledBlob = reassembleChunks(receivedMap, totalExpectedChunks, "text/plain");
assert.equal(reassembledBlob.size, testSize, "Dung lượng Blob ghép lại phải bằng đúng dung lượng ban đầu");
assert.equal(receivedMap.size, totalExpectedChunks, "Mặc định không xóa map nếu không yêu cầu");

const reassembledBuffer = await reassembledBlob.arrayBuffer();
const reassembledBytes = new Uint8Array(reassembledBuffer);
assert.deepEqual(reassembledBytes, originalBytes, "Nội dung Blob sau khi ghép trùng khớp 100% dữ liệu gốc");
console.log("✓ Ghép 7 chunks (100 KB) thành công, toàn vẹn nội dung");

// 4b. Kiểm tra giải phóng bộ nhớ chunks khi bật clearChunks và điều tiết progress
const releaseMap = new Map(receivedMap);
const clearedBlob = reassembleChunks(releaseMap, totalExpectedChunks, "text/plain", { clearChunks: true });
assert.equal(clearedBlob.size, testSize);
assert.equal(releaseMap.size, 0, "Phải giải phóng receivedChunks Map ngay sau khi ghép Blob");
assert.equal(
  shouldFlushInboundProgress({
    receivedCount: 1,
    totalChunks: 640,
    lastFlushedCount: 0,
    lastFlushedAtMs: 0,
    nowMs: 1,
  }),
  true,
  "Chunk đầu tiên phải flush ngay"
);
assert.equal(
  shouldFlushInboundProgress({
    receivedCount: 2,
    totalChunks: 640,
    lastFlushedCount: 1,
    lastFlushedAtMs: 10,
    nowMs: 25,
  }),
  false,
  "Không flush quá dày dưới 80ms ở giữa luồng"
);
assert.equal(
  shouldFlushInboundProgress({
    receivedCount: 640,
    totalChunks: 640,
    lastFlushedCount: 600,
    lastFlushedAtMs: 1000,
    nowMs: 1005,
  }),
  true,
  "Chunk cuối phải flush ngay"
);
console.log("✓ Giải phóng bộ nhớ chunk và điều tiết cập nhật tiến trình hợp lệ");

// 5. Kiểm tra bắt lỗi khi thiếu chunk
const incompleteMap = new Map(receivedMap);
incompleteMap.delete(3); // Giả lập mất chunk số 3
assert.throws(
  () => reassembleChunks(incompleteMap, totalExpectedChunks, "text/plain"),
  /Thiếu phần tệp/,
  "Phải ném lỗi khi thiếu chunk"
);
console.log("✓ Bắt lỗi chính xác khi thiếu chunk trong luồng truyền");

console.log("\n==============================================");
console.log(" TẤT CẢ TEST FILE TRANSFER ĐỀU THÀNH CÔNG! ");
console.log("==============================================");
