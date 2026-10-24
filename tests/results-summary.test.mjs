import test from 'node:test';
import assert from 'node:assert/strict';
import { resultsChargeMessage } from '../lib/results-summary.ts';
test('savings use the actual total charge and original estimate',()=>assert.equal(resultsChargeMessage(17,20),'You saved 3 Sparks — charged 17 of the estimated 20.'));
test('equal or higher charges never claim savings',()=>{for(const spent of [20,25])assert.equal(resultsChargeMessage(spent,20),`Charged ${spent} Sparks for this analysis.`)});
test('unknown estimate remains neutral and zero charge is explicit',()=>{assert.equal(resultsChargeMessage(17,null),'Charged 17 Sparks for this analysis.');assert.equal(resultsChargeMessage(0,null),'No Sparks were charged.');});
