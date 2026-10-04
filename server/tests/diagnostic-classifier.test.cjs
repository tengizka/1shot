const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const script=fs.readFileSync('server/Diagnose-Export.ps1','utf8');
const fn=script.slice(script.indexOf('function classify(e){'),script.indexOf('\ntry {\n stage=\'CONFIG\''));
const classify=vm.runInNewContext(fn+'\nclassify');
for(const [error,result] of [
 [{code:'28P01',message:'Tenant or user not found'},'POOLER_TENANT_OR_USER_NOT_FOUND'],
 [{code:'28000',message:'Tenant or user not found'},'POOLER_TENANT_OR_USER_NOT_FOUND'],
 [{code:'28P01',message:'password authentication failed for user SYNTHETIC_SECRET'},'PASSWORD_AUTH_FAILED'],
 [{cause:{message:'SASL authentication failed SYNTHETIC_SECRET'}},'AUTH_PROTOCOL_ERROR'],
 [{code:'28P01',message:'unknown SYNTHETIC_SECRET'},'INVALID_PASSWORD_RESPONSE'],
 [{code:'28000'},'AUTHORIZATION_REJECTED'],
 [{message:'certificate verify failed'},'TLS_ERROR'],
 [{message:'postgresql://user:SYNTHETIC_SECRET@example.invalid'},'FAILED'],
])test(result+JSON.stringify(error),()=>{assert.equal(classify(error),result);assert.ok(!classify(error).includes('SYNTHETIC_SECRET'));assert.ok(script.includes("'"+result+"'"));});
