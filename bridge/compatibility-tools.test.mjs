import test from 'node:test';
import assert from 'node:assert/strict';
import {compatibilityToolArgs,disabledCompatibilityFeatures,shellQuote,forbiddenCompatibilityTools} from './compatibility-tools.mjs';
test('compatibility isolation is explicit, invocation-local, and keeps hosted search',()=>{
 const args=compatibilityToolArgs();
 assert.ok(args.includes('--ignore-user-config'));assert.ok(args.includes('--strict-config'));
 for(const feature of ['shell_tool','plugins','apps','browser_use','computer_use','multi_agent','hooks','view_image'])assert.ok(disabledCompatibilityFeatures.includes(feature));
 assert.ok(!disabledCompatibilityFeatures.includes('code_mode_host'),'Native web search needs the tool host');
 assert.ok(args.includes('default_permissions="application_reasoning"'));assert.ok(args.includes('project_doc_max_bytes=0'));
 assert.ok(args.includes('mcp_servers={}'));assert.ok(args.includes('agents.enabled=false'));assert.ok(args.includes('web_search="live"'));
 assert.equal(new Set(disabledCompatibilityFeatures).size,disabledCompatibilityFeatures.length);
 assert.ok(!args.some(a=>/auth|dangerously|never/.test(a)));
});
test('bash arguments are literal including quotes and command syntax',()=>{
 assert.equal(shellQuote('model_reasoning_effort="low"'),"'model_reasoning_effort=\"low\"'");
 assert.equal(shellQuote("a'b"),"'a'\\''b'");assert.equal(shellQuote('$(whoami); x'),"'$(whoami); x'");
});
test('only hosted search events are admitted in compatibility output',()=>{
 assert.deepEqual(forbiddenCompatibilityTools([]),[]);assert.deepEqual(forbiddenCompatibilityTools(['web_search']),[]);
 assert.deepEqual(forbiddenCompatibilityTools(['shell','web_search','playwright.browser_navigate','file_change']),['shell','playwright.browser_navigate','file_change']);
});
