import test from 'node:test';
import assert from 'node:assert/strict';
import {drawWatermarkPreview,watermarkCanvasPos} from '../lib/watermark.ts';
test('watermark follows export waypoints and repeats after twelve seconds',()=>{
 assert.deepEqual(watermarkCanvasPos(0,1920,1080,300,68,22),{x:1598,y:990});
 assert.deepEqual(watermarkCanvasPos(4,1920,1080,300,68,22),{x:810,y:506});
 assert.deepEqual(watermarkCanvasPos(8,1920,1080,300,68,22),{x:22,y:990});
 assert.deepEqual(watermarkCanvasPos(12,1920,1080,300,68,22),{x:1598,y:990});
});
test('preview uses export coordinate scale and watermark text',()=>{
 const calls=[];const ctx={save(){},restore(){},scale(...args){calls.push(args)},measureText(){return {width:300,actualBoundingBoxAscent:60,actualBoundingBoxDescent:8}},fillText(...args){calls.push(args)}};
 drawWatermarkPreview(ctx,0,480,270,1920,1080);
 assert.deepEqual(calls,[[0.25,0.25],['klyp.world',1598,990]]);
});
