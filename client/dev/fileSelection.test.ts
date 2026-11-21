import test from 'node:test'
import assert from 'node:assert/strict'
import { fileSizeIssue, MAX_FILE_SIZE } from '../src/lib/fileTransfer.ts'

test('outbound file selection rejects empty/invalid sizes and enforces the 10 MB boundary', () => {
  for (const size of [0, -1, NaN, Infinity]) assert.equal(fileSizeIssue(size), 'empty')
  assert.equal(fileSizeIssue(1), null)
  assert.equal(fileSizeIssue(MAX_FILE_SIZE), null)
  assert.equal(fileSizeIssue(MAX_FILE_SIZE + 1), 'too-large')
})
