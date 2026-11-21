import test from 'node:test'
import assert from 'node:assert/strict'
import {filterSelectItems,moveSelectIndex} from '../src/lib/selectOptions.ts'

test('workspace search ignores Vietnamese accents and searches role descriptions',()=>{
 const items=[{value:'1',label:'Đội thiết kế',description:'Chủ Workspace'},{value:'2',label:'Tokyo',description:'Thành viên'}]
 assert.equal(filterSelectItems(items,'doi thiet ke')[0]?.value,'1')
 assert.equal(filterSelectItems(items,'thanh vien')[0]?.value,'2')
 assert.deepEqual(filterSelectItems(items,'không tồn tại'),[])
 assert.equal(filterSelectItems(items,'  ').length,2)
})
test('duplicate display names preserve distinct workspace IDs and long names',()=>{
 const items=[{value:'a',label:'Bifrost'},{value:'b',label:'Bifrost'},{value:'c',label:'Phòng nghiên cứu '.repeat(10)}]
 assert.deepEqual(filterSelectItems(items,'Bifrost').map(x=>x.value),['a','b'])
 assert.equal(filterSelectItems(items,'nghien cuu')[0]?.value,'c')
})
test('keyboard option navigation wraps safely and handles an empty result',()=>{
 assert.equal(moveSelectIndex(2,3,1),0)
 assert.equal(moveSelectIndex(0,3,-1),2)
 assert.equal(moveSelectIndex(0,0,1),-1)
})
