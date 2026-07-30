// Verify the Greenhouse question bank by EXTRACTING DEFAULT_GH_QUESTIONS from eve/greenhouse.js
// and replaying the first-match rule against real question text observed on live gh pages
// (turbineone + 6sense, 2026-07-26, plus xAI/Databricks from the SEEN QUESTIONS LOG).
//
// Same extract-don't-retype rule as tools/bank-test.js: hand-typed regexes test the retype, not
// the shipped file, and miss corruption like the 0x08 backspace incident.
//
// Usage: node tools/gh-bank-test.js
const fs = require('fs');
const path = require('path');

const GH = path.join(__dirname, '..', 'eve', 'greenhouse.js');
const src = fs.readFileSync(GH, 'utf8');
const backgroundSrc = fs.readFileSync(path.join(__dirname, '..', 'eve', 'background.js'), 'utf8');
const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'eve', 'ui.css'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'eve', 'manifest.json'), 'utf8'));

// Guard: no stray control characters anywhere in the source.
const controlChars = [...src].filter(ch => {
  const code = ch.charCodeAt(0);
  return code < 32 && ch !== '\n' && ch !== '\r' && ch !== '\t';
});

function extractScalar(name) {
  const m = new RegExp(`const ${name} = ('|")(.*?)\\1;`).exec(src);
  return m ? m[2] : undefined;
}
const SALARY_EXPECTATION = extractScalar('SALARY_EXPECTATION');

function extractArray(name) {
  const start = src.indexOf(`const ${name} = [`);
  if (start === -1) throw new Error('not found: ' + name);
  const open = src.indexOf('[', start);
  let depth = 0, end = -1;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '[') depth++;
    else if (src[j] === ']') { depth--; if (depth === 0) { end = j; break; } }
  }
  return eval(`(function(SALARY_EXPECTATION){ return ${src.slice(open, end + 1)}; })(${JSON.stringify(SALARY_EXPECTATION)})`);
}

const BANK = extractArray('DEFAULT_GH_QUESTIONS');

// Same rule as matchBankEntry: first entry whose patterns match and whose exclude does not.
const pick = text => BANK.find(e =>
  !(e.exclude && e.exclude.test(text)) && e.patterns.some(r => r.test(text))) || null;

let pass = 0, fail = 0;
const assert = (ok, label) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };
const routes = (text, topic) => assert(
  (pick(text)?.topic ?? '(none)') === topic,
  `${topic.padEnd(34)} <- ${text.slice(0, 62)}${(pick(text)?.topic ?? '(none)') === topic ? '' : `   [got ${pick(text)?.topic ?? '(none)'}]`}`);

console.log('=== Source hygiene ===');
assert(controlChars.length === 0, `no stray control chars in greenhouse.js (found ${controlChars.length})`);
assert(SALARY_EXPECTATION === '160000', `SALARY_EXPECTATION constant resolves (${SALARY_EXPECTATION})`);

console.log('\n=== 6sense (live 2026-07-26) ===');
routes('Will you now or in the future require visa sponsorship?', 'sponsorship');
routes('Do you have professional experience building production applications using Java and Spring Boot?', 'experience-java-spring');
routes('Have you professionally developed both backend services and frontend applications (React/TypeScript or similar) as part of the same software engineering role?', 'experience-backend-frontend');
routes('Have you deployed and supported production applications running in a public cloud environment (AWS, Azure, or GCP) using containers and/or Kubernetes?', 'experience-cloud-containers');
routes('Gender', 'gender');
routes('Are you Hispanic/Latino?', 'hispanic-latino');
routes('Please identify your race', 'race-ethnicity');
routes('Veteran Status', 'veteran');
routes('Disability Status', 'disability');
const AGE_MAJORITY_CONTRACT = 'Are you at least the age of majority under applicable law (i.e., age 18 in most states, but age 19 in Alabama and Nebraska) and have the right to contract in your own name?';
routes(AGE_MAJORITY_CONTRACT, 'age-minimum');
assert(pick(AGE_MAJORITY_CONTRACT).choose === 'yes', 'age of majority + right to contract -> Yes');
routes('Are you at least 18 years of age?', 'age-minimum');
assert(pick('Are you at least 18 years of age?').choose === 'yes', 'ordinary minimum-age wording remains Yes');

console.log('\n=== VeriPark shared topics (2026-07-27) ===');
routes('Have you applied with VeriPark previously?', 'prior-application');
assert(pick('Have you applied with VeriPark previously?').choose === 'no', 'prior application -> No');
routes('What is your desired Monthly Salary?', 'salary-monthly');
assert(pick('What is your desired Monthly Salary?').text === '12000', 'monthly salary -> 12000');
routes('Please select the currency', 'salary-currency');
assert(pick('Please select the currency').optionMatch.test('USD'), 'currency -> USD');
routes('Do you have Banking/BFSI domain experience?', 'banking-bfsi-experience');
assert(pick('Do you have Banking/BFSI domain experience?').choose === 'yes', 'Banking/BFSI -> Yes');
routes('Are you legally permitted to work in the country where this job is located?', 'work-authorization');
const FIELD_YEARS = 'How many years of experience do you have in the field described in the job description you are applying for?';
routes(FIELD_YEARS, 'years-experience-field-described');
assert(pick(FIELD_YEARS).text === '5', 'described-field experience -> 5');
routes('I understand and acknowledge the terms of use', 'acknowledgement-generic');
routes('What is your desired start date?', 'desired-start-date');
assert(pick('What is your desired start date?').text === '09/07/2026', 'shared desired start date -> 09/07/2026');
routes('Have you in the past or are you currently interviewing for any positions with Insperity?', 'prior-current-interview');
assert(pick('Have you in the past or are you currently interviewing for any positions with Insperity?').choose === 'no', 'shared prior/current interview -> No');
assert(pick('I understand and acknowledge the terms of use').choose === 'yes', 'generic acknowledgement -> Yes');
assert(src.indexOf('div[role="combobox"]') < src.indexOf('for (const boxes of checkboxGroups(form))'), 'Greenhouse/Ashby choice precedence tries dropdown before checkbox');

console.log('\n=== Accenture Federal Services (user screenshot 2026-07-26) ===');
const ACCENTURE_RELATIONSHIP = 'Do you have any family members or people you have close relationships with who work for Accenture Federal Services?';
routes(ACCENTURE_RELATIONSHIP, 'relatives-at-company');
assert(pick(ACCENTURE_RELATIONSHIP).choose === 'no', 'Accenture family/close-relationship question -> No');
routes('Do you have a close personal relationship with anyone employed at Example Corp?', 'relatives-at-company');
routes('Degree', 'degree');
routes('State', 'state');
routes('Have you entered into a non-disclosure or non-compete agreement or understanding of any kind?', 'restrictive-agreements');
routes('Will you be serving as enlisted personnel in either the Reserves or the National Guard while working for AFS?', 'military-service');
const ACCENTURE_GOV_PAST = 'Were you an employee of the U.S. Government (including U.S. Congress or military) or any state or local government within the past 10 years?';
routes(ACCENTURE_GOV_PAST, 'government-employment');
routes('Do you hold a security clearance?', 'security-clearance');
assert(BANK.find(e => e.topic === 'security-clearance').optionMatch.test('None'), 'Accenture security clearance -> None');
const ACCENTURE_PROJECT = 'At your current employer, are you currently working on a project with Accenture or have you worked on a project with Accenture in the past 24 months?';
routes(ACCENTURE_PROJECT, 'current-employer-accenture-project');
assert(pick(ACCENTURE_PROJECT).choose === 'yes', 'Accenture current-employer project -> Yes');

console.log('\n=== Stratolaunch Systems Engineer (live inventory 2026-07-26) ===');
routes('Complete current mailing address', 'mailing-address');
assert(pick('Complete current mailing address').profileKey === 'mailingAddress', 'mailing address comes from the profile, not a literal in source');
const STRATO_CITIZENSHIP = 'Certain U.S. government contracts supported by our company prohibit employment of individuals who hold citizenship (including dual citizenship) in specific countries designated by the U.S. Department of State. Please indicate whether you currently hold citizenship (including dual citizenship) in any of the following countries:';
routes(STRATO_CITIZENSHIP, 'restricted-country-citizenship');
routes('A government contract prohibits employment based on citizenship in listed countries. Please indicate whether you hold citizenship in any listed country.', 'restricted-country-citizenship');
const stratoCitizenship = BANK.find(e => e.topic === 'restricted-country-citizenship');
assert(stratoCitizenship.optionMatch.test('I do not hold citizenship in any of the countries listed'), 'restricted-country group chooses the explicit none-listed option');
assert(!stratoCitizenship.optionMatch.test('People’s Republic of China'), 'restricted-country group rejects the prior inferred PRC option');
const STRATO_ADDITIONAL_CITIZENSHIP = 'The previous question addressed citizenship in certain countries subject to contractual restrictions. In addition to U.S. citizenship, do you currently hold citizenship in any other country (including dual or multiple citizenship)?';
routes(STRATO_ADDITIONAL_CITIZENSHIP, 'additional-citizenship');
assert(pick(STRATO_ADDITIONAL_CITIZENSHIP).text === 'People’s Republic of China', 'additional citizenship states actual citizenship');
const STRATO_KNOWS = 'Do you currently know anyone who works for Stratolaunch or WindWright? If yes, please list their name. If no, please list "N/A".';
routes(STRATO_KNOWS, 'know-someone-at-company');
assert(pick(STRATO_KNOWS).text === 'N/A', 'Stratolaunch acquaintance question -> N/A');
routes('How did you hear about us?', 'how-heard');
assert(pick('For purposes of complying with Federal Export Control Laws, please select one of the following:') === null, 'Stratolaunch export-control status stays unanswered');
assert(pick('Do you currently hold a US Department of Defense Security Clearance? If so, what level of clearance?') === null, 'current DoD clearance stays unanswered');
assert(pick("To the best of your knowledge, are you able to obtain a US Department of Defense Security Clearance if you don't currently hold one?") === null, 'DoD clearance eligibility stays unanswered');
assert(pick('Drug Free Workplace') === null, 'drug-free acknowledgement stays unanswered');

console.log('\n=== Relativity screenshot (2026-07-26) ===');
const REL_LOCATION = 'Please list your current location (City, State or Province)';
routes(REL_LOCATION, 'current-location-text');
routes('Are you currently located in North America?', 'current-location-north-america');
assert(pick('Are you currently located in North America?').choose === 'yes', 'North America location -> Yes');
routes('Are you based in New York or San Francisco?', 'based-in-ny-or-sf');
assert(pick('Are you based in New York or San Francisco?').choose === 'no', 'New York or San Francisco location -> No');
const AI_USAGE_PROMPT = 'In 3–4 sentences, describe how you use (or choose not to use) AI tools in your work. Please include a concrete example of when AI has been helpful to you.';
routes(AI_USAGE_PROMPT, 'ai-tools-usage-essay');
const aiUsageAnswer = pick(AI_USAGE_PROMPT).text;
assert((aiUsageAnswer.match(/[.!?](?:\s|$)/g) || []).length === 4, 'AI-tools usage answer has exactly 4 sentences');
assert(/Claude[\s\S]*Codex[\s\S]*Copilot/i.test(aiUsageAnswer) && /integration tests/i.test(aiUsageAnswer), 'AI-tools usage answer includes named tools and concrete integration-test example');
const ENTREPRENEURIAL_PROMPT = 'In what ways are you entrepreneurial?';
routes(ENTREPRENEURIAL_PROMPT, 'entrepreneurial-ways-essay');
const entrepreneurialAnswer = pick(ENTREPRENEURIAL_PROMPT).text;
assert(/taught myself programming/i.test(entrepreneurialAnswer) && /cofounded a startup/i.test(entrepreneurialAnswer) && /Chrome extension/i.test(entrepreneurialAnswer), 'entrepreneurial answer preserves the user-supplied career, startup, and product examples');
assert((entrepreneurialAnswer.match(/[.!?](?:\s|$)/g) || []).length === 4, 'entrepreneurial answer has exactly 4 sentences');
const RAMP_SMS = 'Check Yes or No to indicate your agreement to receive text message updates from Ramp Business Corporation regarding your job application. Frequency may vary. Message and data rates may apply.';
routes(RAMP_SMS, 'consent-sms-contact');
assert(pick(RAMP_SMS).optionMatch.test('No - I do not consent to receiving text messages'), 'Ramp SMS consent -> No');
assert(!pick(RAMP_SMS).optionMatch.test('Yes - I consent to receiving text messages'), 'Ramp SMS consent rejects Yes');
const NO_SPONSOR_WORK_AUTH = 'Are you authorized to work in the U.S. without company sponsorship?';
routes(NO_SPONSOR_WORK_AUTH, 'unrestricted-right-to-work');
assert(pick(NO_SPONSOR_WORK_AUTH).choose === 'yes', 'work authorization without company sponsorship -> Yes');
const COUNTRY_OF_RESIDENCE = 'What is your country of residence?';
routes(COUNTRY_OF_RESIDENCE, 'country-of-residence');
assert(pick(COUNTRY_OF_RESIDENCE).optionMatch.test('U.S.'), 'country of residence matches U.S. checkbox label');
assert(!pick(COUNTRY_OF_RESIDENCE).optionMatch.test('Canada') && !pick(COUNTRY_OF_RESIDENCE).optionMatch.test('Other'), 'country of residence rejects Canada and Other');
const RECENT_BUILD = "What's something you've built recently?";
routes(RECENT_BUILD, 'recent-build-essay');
assert(/Google ADK[\s\S]*FastAPI[\s\S]*Azure OpenAI[\s\S]*AWS Bedrock/i.test(pick(RECENT_BUILD).text), 'recent-build essay preserves the supplied AI-agent stack');
assert(/hundreds of hours per month/i.test(pick(RECENT_BUILD).text), 'recent-build essay preserves the projected impact');
const COMMONWARE_FIT = 'Why are you a good fit for Commonware?';
routes(COMMONWARE_FIT, 'ideal-candidate-pitch');
assert(/end-to-end ownership/i.test(pick(COMMONWARE_FIT).text) && /observability/i.test(pick(COMMONWARE_FIT).text), 'Commonware good-fit prompt uses the supplied ownership essay');
const RAMP_RELOCATE_OR_BASED = 'Are you based in NYC or SF or willing to relocate?';
routes(RAMP_RELOCATE_OR_BASED, 'relocation-hybrid');
assert(pick(RAMP_RELOCATE_OR_BASED).choose === 'yes', 'NYC/SF or willing-to-relocate combined question -> Yes');
const RAMP_SPONSORSHIP_SEGMENTED = 'Will you now or in the future require sponsorship for an employment visa (e.g., H-1B, TN, etc.)?';
routes(RAMP_SPONSORSHIP_SEGMENTED, 'sponsorship');
assert(pick(RAMP_SPONSORSHIP_SEGMENTED).choose === 'yes', 'future employment-visa sponsorship segmented question -> Yes');
const RAMP_EXCEPTIONAL = 'We believe exceptional performance in one area is a good indication of performance in other areas. Do you have any examples of exceptional performance you want to highlight?';
routes(RAMP_EXCEPTIONAL, 'exceptional-performance-example');
assert(/Chrome extension/i.test(pick(RAMP_EXCEPTIONAL).text), 'Ramp exceptional-performance answer uses the extension example');
routes('Do you have a minimum of 3 years of experience, not including internships?', 'minimum-three-years-experience');
assert(pick('Do you have a minimum of 3 years of experience, not including internships?').choose === 'yes', 'Ramp minimum 3 years -> Yes');
const RAMP_US_CANADA = 'Are you currently based in the U.S. or Canada and/or currently authorized to work in one of these locations?';
routes(RAMP_US_CANADA, 'us-canada-location-or-authorization');
assert(pick(RAMP_US_CANADA).choose === 'yes', 'Ramp U.S./Canada location or authorization -> Yes');
const RAMP_NYC = 'Are you comfortable working in-person at our NYC office at least 3 days/week?';
routes(RAMP_NYC, 'nyc-office-relocation');
assert(pick(RAMP_NYC).optionMatch.test('Yes | Able to relocate to NYC upon offer acceptance and comfortable being in the office at least 3 days/week'), 'Ramp NYC office -> relocate option');
assert(!pick(RAMP_NYC).optionMatch.test('Yes | Currently located in NYC and comfortable being in the office at least 3 days/week'), 'Ramp NYC office rejects false current-NYC option');
const RAMP_NYC_SF = 'Are you able to work in-person at either our NYC or SF office at least 3 days/week?';
routes(RAMP_NYC_SF, 'nyc-office-relocation');
assert(pick(RAMP_NYC_SF).optionMatch.test('Yes | Able to relocate to SF or NYC upon offer acceptance and comfortable being in the office at least 3 days/week'), 'Ramp NYC-or-SF office -> relocate option');
assert(!pick(RAMP_NYC_SF).optionMatch.test('Yes | Currently located in SF or NYC and comfortable being in the office at least 3 days/week'), 'Ramp NYC-or-SF office rejects false current-location option');
const MULTI_CITY_OFFICE = 'Are you willing to work either out of our NYC office or San Francisco office 2-3 days per week?';
routes(MULTI_CITY_OFFICE, 'office-attendance-requirement');
assert(pick(MULTI_CITY_OFFICE).choose === 'yes', 'multi-city recurring office attendance -> Yes');
routes('Can you work from our Chicago office four days a week?', 'office-attendance-requirement');
routes('Would you be comfortable coming on-site in Boston 1 day per week?', 'office-attendance-requirement');
routes('Have you read the privacy policy?', 'privacy-notice-acknowledgement');
assert(pick(REL_LOCATION).text === 'Dallas, TX', 'current location -> Dallas, TX');
const REL_REMOTE_STATES = 'If applying to Remote US location, what state(s) are you able to work in?';
routes(REL_REMOTE_STATES, 'remote-us-work-states');
assert(pick(REL_REMOTE_STATES).text === 'CA, WA, TX', 'remote work states -> CA, WA, TX');
routes('Are you legally authorized to work in the country in which the job you are applying for is located?', 'work-authorization');
const REL_SPONSORSHIP = 'Do you now or will you in the future require sponsorship for employment for the location that you are applying to? If so, please explain.';
routes(REL_SPONSORSHIP, 'sponsorship-details');
assert(pick(REL_SPONSORSHIP).text === 'Yes, H1b transfer.', 'combined sponsorship explanation uses screenshot answer');
routes('Are you subject to any restrictive covenant or non-competition agreement that may affect your ability to work for Relativity?', 'restrictive-agreements');
const REL_SALARY = 'My realistic base gross annual salary expectation (not including bonus/commission) for my next role is:';
routes(REL_SALARY, 'salary-range-expectation');
const relSalary = pick(REL_SALARY);
assert(relSalary.optionMatch.test('$160,000 - $180,000'), 'salary range picks $160,000 - $180,000');
assert(!relSalary.optionMatch.test('$140,000 - $160,000'), 'salary range rejects adjacent lower band');
const REL_ACCURACY = 'I confirm that my answers to questions in this online application are complete and accurate and that Relativity may rely on my answers. Permission is granted to Relativity to verify all statements in this online application';
routes(REL_ACCURACY, 'application-accuracy-confirmation');
assert(pick(REL_ACCURACY).choose === 'yes', 'application accuracy confirmation -> Yes');
const ASHBY_STATE = 'What U.S State do you currently reside in?';
routes(ASHBY_STATE, 'state');
assert(pick(ASHBY_STATE).text === 'Texas', 'Ashby state of residence text -> Texas');
assert(pick(ASHBY_STATE).optionMatch.test('Texas'), 'Ashby state of residence picker -> Texas');
const IDENTITY_CASES = [
  ['How would you describe your gender identity? (mark all that apply)', 'gender-identity', 'Man', 'Woman'],
  ['How would you describe your racial/ethnic background? (mark all that apply)', 'racial-ethnic-background', 'East Asian', 'South Asian'],
  ['How would you describe your sexual orientation? (mark all that apply)', 'sexual-orientation', 'Heterosexual', 'Bisexual'],
  ['Do you identify as transgender?', 'transgender', 'No', 'Yes'],
  ['Do you have a disability or chronic condition (physical, visual, auditory, cognitive, mental, emotional, or other) that substantially limits one or more of your major life activities?', 'disability-major-life', 'No', 'Yes'],
  ['Are you a veteran or active member of the United States Armed Forces?', 'veteran-active-member', 'No, I am not a veteran or active member', 'Yes, I am a veteran']
];
for (const [question, topic, wanted, rejected] of IDENTITY_CASES) {
  routes(question, topic);
  const entry = pick(question);
  const matcher = entry.optionMatch || (entry.choose === 'no' ? /^\s*no\b/i : /^\s*yes\b/i);
  assert(matcher.test(wanted), `${topic} picks ${wanted}`);
  assert(!matcher.test(rejected), `${topic} rejects ${rejected}`);
}
console.log('\n=== Rent the Runway topics + generalized variants (2026-07-26) ===');
const RTR_OFFICE = 'Rent the Runway currently operates on an office-centric model, with employees working from our Brooklyn office 4-days per week, and working flexibly on Fridays. Can you meet this requirement?';
routes(RTR_OFFICE, 'office-attendance-requirement');
routes('Our office based model requires working from the office 3 days per week. Can you meet the attendance requirement?', 'office-attendance-requirement');
assert(pick(RTR_OFFICE).choose === 'yes', 'office attendance -> Yes');
routes('Are you fully authorized to work in the United States for any employer?', 'work-authorization');
routes('Are you authorized to work for any employer in the U.S?', 'work-authorization');
routes('Can you work for any US employer without restriction?', 'work-authorization');
routes('Do you now or will you in the future require visa sponsorship in order to work in the United States?', 'sponsorship');
const RTR_ADVISEMENT = "We're hiring for multiple roles, and you don't need to answer all these questions with high proficiency. Please confirm you have read this advisement!";
routes(RTR_ADVISEMENT, 'advisement-read-confirmation');
routes('Please confirm that you have read the notice above.', 'advisement-read-confirmation');
const RTR_TECH = [
  ['How many years of professional experience do you have developing applications using Java with SpringBot and ReactJS?', 'years-java-spring-react'],
  ['How many years have you developed applications with Java, Spring Boot, and React?', 'years-java-spring-react'],
  ['How many years of professional experience do you have working in a microservices-styled, event-driven architecture in a production environment?', 'years-microservices-event-driven'],
  ['How many years have you used event-driven architecture in production?', 'years-microservices-event-driven'],
  ['How many years of professional experience do you have working with relational databases, such as MySQL?', 'years-relational-database'],
  ['How many years have you worked with a relational database or DB?', 'years-relational-database'],
  ['How many years of professional experience do you have working in NoSQL or Document databases, such as MongoDB?', 'years-nosql-document-database'],
  ['How many years have you worked with a document database?', 'years-nosql-document-database']
];
for (const [question, topic] of RTR_TECH) {
  routes(question, topic);
  assert(pick(question).text === '4', `${topic} -> 4`);
}
const RTR_SUPPLY = 'Do you have any experience building software in the supply-chain/logistics space, such as WMS, TMS, WCS, etc?';
routes(RTR_SUPPLY, 'supply-chain-logistics-experience');
routes('Have you built software for logistics or a warehouse management system?', 'supply-chain-logistics-experience');
assert(pick(RTR_SUPPLY).choose === 'no', 'supply-chain/logistics experience -> No');

console.log('\n=== TurbineOne (live 2026-07-26) ===');
routes('Other than what you can find on our website, what about TurbineOne is exciting to you?', 'why-company-essay');
routes('Where do you see yourself in five years?', 'five-year-plan-essay');
// Recruiter essays: user answered both 2026-07-26 (banked verbatim in [ESSAYS]) — now topics.
routes("Describe a hire you're most proud of. What made them successful after they joined, and what role did you personally play in that outcome? (Please be specific.)", 'proudest-hire-essay');
routes("Tell us about the smallest company you've recruited for.", 'smallest-company-essay');
// …and nothing else steals them / they steal nothing else.
assert(pick("Describe a hire you're most proud of. What made them successful after they joined, and what role did you personally play in that outcome? (Please be specific.)").topic !== 'proud-work-essay', 'hire essay not stolen by proud-work-essay');
routes('What exceptional work have you done?', 'proud-work-essay');
routes('Tell us about a project you are most proud of', 'proud-work-essay');
assert(pick('Current Company')?.topic !== 'smallest-company-essay', 'Current Company untouched by smallest-company-essay');
assert(pick("What's the proudest hire you've made?")?.topic === 'proudest-hire-essay', 'proudest-hire variant phrasing matches');
assert(pick('What is the smallest company you have recruited for?')?.topic === 'smallest-company-essay', 'smallest-company variant phrasing matches');
const proudestHire = () => BANK.find(e => e.topic === 'proudest-hire-essay');
const smallestCo = () => BANK.find(e => e.topic === 'smallest-company-essay');
assert(/software engineer rather than a professional recruiter/.test(proudestHire().text), 'proudest-hire text is the banked user-approved paragraph');
assert(/three-person startup building a WeChat chatbot/.test(smallestCo().text), 'smallest-company text is the banked user-approved paragraph');
assert(![...proudestHire().text + smallestCo().text].some(ch => /[<>\[\]"{}\\]/.test(ch)), 'essay texts contain no illegal characters');

console.log('\n=== Website-vs-essay ordering (v1.1.191 regression, TurbineOne live string) ===');
// Extract GH_PROFILE (object) and GH_PROFILE_FIELDS (array) from source too.
function extractFreezeObject(name) {
  const marker = `const ${name} = Object.freeze(`;
  const start = src.indexOf(marker);
  if (start === -1) throw new Error('not found: ' + name);
  const open = src.indexOf('{', start);
  let depth = 0, end = -1;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
  }
  return eval(`(${src.slice(open, end + 1)})`);
}
// Placeholder defaults from source, overlaid with this checkout's profile (profile.local.json
// when present, otherwise the committed example) — exactly what the engine does at run time.
const GH_PROFILE_DEFAULTS = extractFreezeObject('GH_PROFILE_DEFAULTS');
const profilePath = ['profile.local.json', 'profile.example.json']
  .map(f => path.join(__dirname, '..', 'eve', f))
  .find(f => fs.existsSync(f));
const PROFILE_IDENTITY = profilePath ? (JSON.parse(fs.readFileSync(profilePath, 'utf8')).identity || {}) : {};
const GH_PROFILE = { ...GH_PROFILE_DEFAULTS, ...PROFILE_IDENTITY };
const FIELDS = (() => {
  const start = src.indexOf('return [', src.indexOf('function buildGH_PROFILE_FIELDS('));
  const open = src.indexOf('[', start);
  let depth = 0, end = -1;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '[') depth++;
    else if (src[j] === ']') { depth--; if (depth === 0) { end = j; break; } }
  }
  return eval(`(function(GH_PROFILE){ return ${src.slice(open, end + 1)}; })(GH_PROFILE)`);
})();
// Replicas of matchProfileField + the text-fill decision order in runGhApply. Source markers are
// asserted below so drift between this replica and the shipped logic fails the test.
const matchProfileField = label => FIELDS.find(e => {
  if (e.shortLabelOnly && (label.length > 40 || label.includes('?'))) return false;
  return e.label.test(label);
}) || null;
assert(matchProfileField('Legal Name')?.value === 'Xiaoxiao Lei', 'Ramp Legal Name -> Xiaoxiao Lei');
const textFillDecision = (label, isTextarea) => {
  const profile = matchProfileField(label);
  if (!isTextarea && profile) return { kind: 'profile', value: profile.value };
  const entry = pick(label);
  if (entry && (entry.text != null || entry.choose)) return { kind: 'bank', topic: entry.topic };
  if (profile) return { kind: 'profile', value: profile.value };
  return { kind: 'unmatched' };
};
assert(/shortLabelOnly && \(label\.length > 40 \|\| label\.includes\('\?'\)\)/.test(src), 'shipped matchProfileField carries the short-label guard');
assert(/isEssayControl = input\.tagName === 'TEXTAREA'/.test(src), 'shipped fill loop keys the bank-first order on TEXTAREA');
const WHY_LIVE = 'Other than what you can find on our website, what about TurbineOne is exciting to you?';
routes(WHY_LIVE, 'why-company-essay');
assert(matchProfileField(WHY_LIVE) === null, 'website profile entry does NOT match the essay sentence (anchor + short-label guard)');
const whyDecision = textFillDecision(WHY_LIVE, true);
assert(whyDecision.kind === 'bank' && whyDecision.topic === 'why-company-essay', `TurbineOne why-company textarea gets the essay (got ${JSON.stringify(whyDecision)})`);
const whyAsInput = textFillDecision(WHY_LIVE, false);
assert(whyAsInput.kind === 'bank' && whyAsInput.topic === 'why-company-essay', 'even as a non-textarea the sentence label routes to the essay, never the GitHub URL');
const websiteDecision = textFillDecision('Website', false);
assert(websiteDecision.kind === 'profile' && websiteDecision.value === 'https://github.com/Dark417', `plain "Website" input still gets the GitHub profile URL (got ${JSON.stringify(websiteDecision)})`);
const portfolioDecision = textFillDecision('Portfolio', false);
assert(portfolioDecision.kind === 'profile' && portfolioDecision.value === 'https://github.com/Dark417', 'plain "Portfolio" input still gets the GitHub profile URL');
const linkedinDecision = textFillDecision('LinkedIn Profile', false);
assert(linkedinDecision.kind === 'profile' && linkedinDecision.value === 'www.linkedin.com/in/xiaoxiaolei/', 'LinkedIn Profile input gets the scheme-less value');
routes('What about our mission excites you?', 'why-company-essay');
const INTERESTED_ROLE = 'What interested you about this role?';
routes(INTERESTED_ROLE, 'why-company-essay');
routes('What interests you about this position?', 'why-company-essay');
routes('What made you apply?', 'why-company-essay');
assert(/^I am interested in your company because I thrive in new environments/.test(pick(INTERESTED_ROLE).text), 'why-company essay uses the user-supplied 2026-07-27 wording');
assert(/full-stack development, backend services, cloud infrastructure, data platforms, and AI agents/.test(pick(INTERESTED_ROLE).text), 'why-company essay keeps the breadth-of-experience evidence');
routes('Why are you the ideal candidate for this role?', 'ideal-candidate-pitch');

console.log('\n=== Greenhouse SEEN QUESTIONS LOG regressions (xAI / Databricks 2026-07-15) ===');
routes('Will you now, or in the future, require sponsorship for employment visa status (e.g. H-1B visa status)?', 'sponsorship');
routes('What exceptional work have you done?', 'proud-work-essay');
routes('Please indicate your SpaceXAI employment history.', 'prior-employment');
routes('How did you hear about this job?', 'how-heard');
routes('Are you legally authorized to work in the country in which you are applying?', 'work-authorization');
routes('Do you currently or have you previously worked for Databricks in the past?', 'prior-employment');
routes('Are you a citizen or permanent resident of Cuba, Iran, North Korea, or Syria?', 'export-control-restricted-country');

console.log('\n=== Order-sensitive splits ===');
routes('Do you have unrestricted work authorization for the United States?', 'unrestricted-right-to-work');
assert(pick('Do you have unrestricted work authorization for the United States?').choose === 'yes', 'unrestricted work authorization uses the user-overridden Yes answer');
routes('Do you currently require sponsorship to commence employment?', 'sponsorship-current-commence');
routes('Will you now or in the future require sponsorship for employment visa status?', 'sponsorship');
assert(pick('Will you now or in the future require sponsorship for employment visa status?').choose === 'yes', 'combined now-or-future sponsorship answers Yes');
routes('Are you legally authorized to work in the United States?', 'work-authorization');
assert(pick('Are you legally authorized to work in the United States?').choose === 'yes', 'plain work-auth answers Yes');
routes('Are you willing to relocate to San Francisco?', 'relocation-hybrid');
routes('Are you able to work in a hybrid setting in our NYC based office?', 'relocation-hybrid');
routes('Can you work 3 days a week in the office?', 'relocation-hybrid');

console.log('\n=== Identity questions must NOT be stolen by the bank ===');
// "Current Company" is an identity text field (GH_PROFILE_FIELDS), not a prior-employment question.
assert(pick('Current Company')?.topic !== 'prior-employment', 'Current Company not treated as prior-employment');
assert(pick('Current Title')?.topic !== 'prior-employment', 'Current Title not treated as prior-employment');

console.log('\n=== Salary guard ===');
routes('What are your salary expectations?', 'salary-expectation');
assert(pick('What is your current salary?') === null || pick('What is your current salary?').topic !== 'salary-expectation', 'current salary never auto-filled');
assert(pick('Desired hourly rate') === null || pick('Desired hourly rate').topic !== 'salary-expectation', 'hourly rate never auto-filled');
assert(BANK.find(e => e.topic === 'salary-expectation').text === '160000', 'salary answer resolves to 160000');
assert(/text: SALARY_EXPECTATION/.test(src), 'salary entry references the constant, not an inline number');

console.log('\n=== Option matching against LIVE 6sense option lists ===');
const optPick = (topic, options) => {
  const e = BANK.find(x => x.topic === topic);
  if (!e) return '(no entry)';
  // Replicates chooserPicker: optionCandidates = ORDERED precedence, each a full pass.
  if (e.optionCandidates) {
    for (const cand of e.optionCandidates) {
      const hit = options.find(t => cand.test(t));
      if (hit) return hit;
    }
    return '(none)';
  }
  const pred = e.optionMatch ? (t => e.optionMatch.test(t))
    : e.choose === 'yes' ? (t => /^\s*yes\b/i.test(t) || /^\s*i (can|agree|acknowledge|affirm)\b/i.test(t))
    : e.choose === 'no' ? (t => /^\s*no\b/i.test(t)) : null;
  if (!pred) return '(no pred)';
  return options.find(pred) ?? '(none)';
};
assert(optPick('sponsorship', ['Yes', 'No']) === 'Yes', 'sponsorship -> Yes');
assert(optPick('experience-java-spring', ['Yes', 'No']) === 'Yes', 'java/spring -> Yes');
assert(optPick('gender', ['Male', 'Female', 'Decline To Self Identify']) === 'Male', 'gender -> Male');
assert(optPick('hispanic-latino', ['Yes', 'No', 'Decline To Self Identify']) === 'No', 'hispanic -> No');
assert(optPick('race-ethnicity', ['American Indian or Alaskan Native', 'Asian', 'Black or African American', 'White', 'Native Hawaiian or Other Pacific Islander', 'Two or More Races', 'Decline To Self Identify']) === 'Asian', 'race -> Asian');
const VET = ['I am not a protected veteran', 'I identify as one or more of the classifications of a protected veteran', "I don't wish to answer"];
assert(optPick('veteran', VET) === 'I am not a protected veteran', 'veteran -> I am not a protected veteran');
const vetEntry = BANK.find(e => e.topic === 'veteran');
assert(!vetEntry.optionMatch.test('I identify as one or more of the classifications of a protected veteran'), 'veteran matcher rejects the protected-veteran declaration');
const DIS = ['Yes, I have a disability, or have had one in the past', 'No, I do not have a disability and have not had one in the past', 'I do not want to answer'];
assert(optPick('disability', DIS) === 'No, I do not have a disability and have not had one in the past', 'disability -> No, I do not have a disability…');
const disEntry = BANK.find(e => e.topic === 'disability');
assert(!disEntry.optionMatch.test('Yes, I have a disability, or have had one in the past'), 'disability matcher rejects the Yes option');
assert(optPick('degree', ['Assoc. Degree/College Diploma', "Bachelor's Degree", 'Higher Degree', 'Master’s Degree']) === 'Master’s Degree', 'Accenture Degree -> Master’s Degree');
assert(optPick('state', ['California', 'Texas', 'Virginia']) === 'Texas', 'Accenture State -> Texas');
// xAI employment-history dropdown: the "never worked" option must win.
assert(optPick('prior-employment', ['I have never worked for SpaceX, xAI, X, or Twitter', 'I currently work for xAI', 'I previously worked for SpaceX']) === 'I have never worked for SpaceX, xAI, X, or Twitter', 'employment-history dropdown -> never worked');
// years-of-experience band: starts at 5, rejects ceilings.
const POSITION_YOE = 'How many years of relevant work experience do you have for this position?';
routes(POSITION_YOE, 'years-of-relevant-experience-position');
const positionYoe = BANK.find(e => e.topic === 'years-of-relevant-experience-position');
assert(positionYoe.optionMatch.test('4 - 6 YoE'), 'position-specific YOE picks 4 - 6 YoE');
assert(!positionYoe.optionMatch.test('5 to 7 Years of Experience'), 'position-specific YOE rejects the generic 5-to-7 band');
// 5 years of experience -> the band that CONTAINS 5, by ordered precedence over the real option list.
assert(optPick('years-of-relevant-experience', ['Up to 5 Years of Experience', '2 to 4 Years of Experience', '5 to 7 Years of Experience']) === '5 to 7 Years of Experience', 'YOE picks 5 to 7 over Up to 5');
assert(optPick('years-of-relevant-experience', ['Less than 1 year', '1 to 3 years', '5+ years']) === '5+ years', 'YOE picks 5+');
assert(optPick('years-of-relevant-experience', ['Less than 1 year', '1 to 3 years', '4 to 7 years', '8 or more years']) === '4 to 7 years', 'YOE picks the 4-to-7 band, which contains 5');
assert(optPick('years-of-relevant-experience', ['0-2 years', '3-5 years', '6-10 years']) === '3-5 years', 'YOE takes the band ending at 5 rather than overstating with 6-10');
assert(optPick('years-of-relevant-experience', ['1 to 3 years', '2 to 4 years']) === '(none)', 'YOE picks nothing when no band contains 5, rather than overstating');
// relocation/hybrid: the "I can" phrasing counts as affirmative.
assert(optPick('relocation-hybrid', ['I can work 3 days a week in the NYC office', 'I cannot work 3 days a week in an office']) === 'I can work 3 days a week in the NYC office', 'hybrid -> I can option');
const relo = BANK.find(e => e.topic === 'relocation-hybrid');
assert(!relo.optionMatch.test('I cannot work 3 days a week in an office'), 'hybrid matcher rejects the cannot option');

console.log('\n=== Precedence topics (screenshots 2026-07-26) + Ashby/Cape ===');
routes('Privacy Notice Acknowledgement', 'privacy-notice-acknowledgement');
routes('Note from Iterable', 'privacy-notice-acknowledgement');
routes('Please read and acknowledge the note below', 'privacy-notice-acknowledgement');
assert(optPick('privacy-notice-acknowledgement', ['Acknowledge']) === 'Acknowledge', 'privacy-ack precedence 1: Acknowledge');
assert(optPick('privacy-notice-acknowledgement', ['Yes', 'No']) === 'Yes', 'privacy-ack precedence 2: Yes when no Acknowledge');
assert(optPick('privacy-notice-acknowledgement', ['I accept', 'Decline']) === 'I accept', 'privacy-ack precedence 3: accept');
assert(BANK.find(e => e.topic === 'privacy-notice-acknowledgement').check === true, 'privacy-ack checks a checkbox control');
routes('Do you consent to the use of your personal information for future job opportunities?', 'consent-future-opportunities');
const PRONOUN_LIVE = 'Iterable is committed to fostering an inclusive workplace. Addressing you by the correct pronoun is an important part of this commitment.';
routes(PRONOUN_LIVE, 'pronouns');
const PRONOUN_OPTS = ['She/Her/Hers', 'He/Him/His', 'They/Them/Theirs', 'Other'];
assert(optPick('pronouns', PRONOUN_OPTS) === 'He/Him/His', 'pronouns -> He/Him/His');
const PRONOUN_SPACED_OPTS = ['She / Her / Hers', 'He / Him / His', 'They / Them / Theirs', 'Ze / Hir / Hirs', 'Prefer not to say / Skip', 'Other'];
assert(optPick('pronouns', PRONOUN_SPACED_OPTS) === 'He / Him / His', 'pronouns checkbox screenshot -> spaced He / Him / His');
assert(optPick('pronouns', ['She/Her/Hers', 'They/Them/Theirs', 'Prefer not to say']) === 'Prefer not to say', 'pronouns fallback -> prefer-not (never She/They)');
routes('Gender', 'gender');
assert(pick('Gender')?.topic !== 'pronouns', 'gender not stolen by pronouns');
assert(pick(PRONOUN_LIVE)?.topic !== 'gender', 'pronoun question not stolen by gender');
const WA_STATUS_LIVE = 'To help us understand timing, which best describes your current work authorization?';
routes(WA_STATUS_LIVE, 'work-auth-status-select');
const CAPE_WA_OPTS = [
  'US Citizen / Permanent Resident (no sponsorship needed)',
  'Currently authorized to work without restriction (ex. asylum, refugee)',
  'On student visa work authorization (F-1 OPT/STEM OPT)',
  'Eligible for TN or E3 status (Canadian, Mexican, Australian citizens)',
  'On a temporary work visa (ex. H-1B) - would need employer to sponsor a transfer',
  'Will require new sponsorship to begin work in the US'
];
assert(optPick('work-auth-status-select', CAPE_WA_OPTS) === 'On a temporary work visa (ex. H-1B) - would need employer to sponsor a transfer', 'work-auth status -> H-1B transfer option');
assert(!BANK.find(e => e.topic === 'work-auth-status-select').optionCandidates.some(c => c.test('US Citizen / Permanent Resident (no sponsorship needed)')), 'never the citizen option');
assert(!BANK.find(e => e.topic === 'work-auth-status-select').optionCandidates.some(c => c.test('Will require new sponsorship to begin work in the US')), 'never the require-new-to-begin option');
routes('Do you have unrestricted work authorization for the United States?', 'unrestricted-right-to-work');
assert(optPick('unrestricted-right-to-work', ['Yes, I have unrestricted work authorization (I am a US citizen, greencard holder, or a citizen of Mexico or Canada)', 'No, I do not have unrestricted work authorization (I require sponsorship to work)']) === 'Yes, I have unrestricted work authorization (I am a US citizen, greencard holder, or a citizen of Mexico or Canada)', 'unrestricted radios -> the Yes option');
routes('Where do you plan to work from?', 'planned-work-location-nyc');
assert(optPick('planned-work-location-nyc', ['NYC', 'Remote', 'Open to relocating to NYC']) === 'Open to relocating to NYC', 'Ramp planned work location -> Open to relocating to NYC');
const CAPE_HYBRID = 'Cape is a hybrid work environment with 3 days a week in office. We have offices in New York, NY and Arlington, VA';
routes(CAPE_HYBRID, 'relocation-hybrid');
assert(optPick('relocation-hybrid', ['I can work 3 days a week in the New York office', 'I can work 3 days a week in the Arlington office', 'I cannot work 3 days a week in an office']) === 'I can work 3 days a week in the New York office', 'Cape hybrid radios -> first CAN option (New York)');

console.log('\n=== LinkedIn value format + engine source markers ===');
assert(!/^https?:\/\//.test(GH_PROFILE.linkedin), 'linkedin value is scheme-less (user 2026-07-26)');
assert(!/https?:\/\//.test(GH_PROFILE.linkedin), 'linkedin value contains no https://');
assert(/^https:\/\//.test(GH_PROFILE.github), 'github stays a full URL');
assert(/function chooserPicker\(/.test(src) && /optionCandidates/.test(src), 'ordered-candidate picker shipped');
assert(/function pickSingletonIndex\(/.test(src), 'singleton-required picker shipped');
const phMatch = /const OPTION_PLACEHOLDER = (\/.+\/i);/.exec(src);
assert(!!phMatch, 'OPTION_PLACEHOLDER extractable');
const PH = eval(phMatch[1]);
assert(PH.test('Select...') && PH.test('Please select one') && !PH.test('Acknowledge'), 'placeholder regex excludes real options');
const singleton = texts => { const real = texts.map((t, i) => ({ t, i })).filter(o => o.t && !PH.test(o.t)); return real.length === 1 ? real[0].i : -1; };
assert(singleton(['Select...', 'Acknowledge']) === 1, 'singleton picks the lone real option');
assert(singleton(['Select...', 'Yes', 'No']) === -1, 'singleton refuses multi-option lists');
assert(/function findSubmitButton\(/.test(src) && /\^submit\( application\)\?\$/.test(src), 'submit button matched by TEXT (Ashby renders all buttons type=submit)');
assert(/function submitAndReport\(/.test(src) && /function missingRequiredControls\(/.test(src) && /function visibleCaptcha\(/.test(src), 'submit-when-complete machinery shipped');
assert(!/Apply Simplify|runApplySimplify|findSimplifyFillButton|ea-gh-simplify-btn|simplify-jobs-shadow-root/i.test(src), 'Greenhouse/Ashby Apply Simplify UI and code are removed');
assert(/panel\.classList\.add\('eve-gh-panel'\)/.test(src), 'Greenhouse/Ashby panel receives its template-layout class');
assert(/#eve-floating-ui\.eve-gh-panel:not\(\.eve-minimized\)/.test(uiSrc) && /height:\s*auto/.test(uiSrc) && /max-height:\s*calc\(100vh - 32px\)/.test(uiSrc), 'Greenhouse/Ashby panel auto-fits content up to the viewport cap');
assert(/\.ea-title\s*\{[\s\S]*line-height:\s*1\.3/.test(uiSrc) && /\.ea-version\s*\{[\s\S]*line-height:\s*1\.3/.test(uiSrc), 'panel title and version isolate nonzero line heights from host CSS');
assert(/function makeHorizontallyResizable\(/.test(src) && /makeHorizontallyResizable\(panel, panel\.querySelector\('\.ea-resize-handle'\)\)/.test(src), 'Greenhouse/Ashby panel exposes horizontal drag resizing');
assert(/const WIDTH_KEY = 'eve_gh_panel_width'/.test(src) && /localStorage\.setItem\(WIDTH_KEY/.test(src), 'Greenhouse/Ashby panel width persists');
assert(/function ashbyApplicationEntryControl\(/.test(src) && /a\[role="tab"\]/.test(src) && /\^application\$/.test(src), 'direct Ashby Overview detects the exact Application tab');
assert(/const form = await ensureApplicationForm\(\)/.test(src) && /Opening the Application tab/.test(src), 'one Eve Apply continues from Ashby Overview into the mounted form');
assert(/size\(\?:=\|%3D\)invisible/.test(src) && /data-size/.test(src), 'explicitly invisible CAPTCHA badge/config does not block submission');
assert(/function securityCodeChallenge\(/.test(src) && /Email security code required/.test(src), 'email-code challenge is detected and held');
assert(!/\|\| !findSubmitButton\(ghForm\(\) \|\| document\)/.test(src), 'missing Submit button alone is not treated as submission success');
assert(/await clickBlankCommitArea\(form\)[\s\S]*?realClick\(button\)/.test(src), 'first Submit is preceded by a safe blank-area commit click');
assert(/const retryButton = findSubmitButton\(currentForm\)[\s\S]{0,500}await clickBlankCommitArea\(currentForm\)[\s\S]{0,900}realClick\(enabledRetryButton\)/.test(src), 'remaining enabled Submit is retried once after a second blank-area click');
assert(/!button\.disabled[\s\S]{0,80}aria-disabled/.test(src), 'submit lookup rejects disabled controls before retry');
assert(/function clearInactiveRelationshipFollowUps\(/.test(src) && /input\[id\^="question_"\]/.test(src), 'inactive relationship Name follow-up is cleared');
assert(/if \(el\.closest\('\.select-shell'\)\) continue/.test(src), 'react-select hidden required sentinels are excluded from generic completeness');
assert(/&& !el\.closest\('\.select-shell'\)/.test(src), 'react-select hidden required sentinels are excluded from the text-fill scan');
assert(/function shellOpen\(/.test(src) && /aria-expanded'\) !== 'true'/.test(src), 'react-select menu open is idempotent');
assert(/if \(\/\(location\|located\)\/i\.test\(label\)\)/.test(src), '"Where are you currently located?" uses the Dallas autocomplete path');
assert(/\^name\$\/i\.test\(label\) && \/\^question_\/i\.test\(input\.id\)/.test(src), 'custom question_* field labelled Name is not treated as the applicant system name');
assert(/function checkboxGroups\(/.test(src) && /function checkboxGroupLabel\(/.test(src), 'checkboxes are grouped by question');
assert(/\.ashby-application-form-field-entry, \[class\*="fieldEntry"\]/.test(src) && /const key = question \|\| box\.name \|\| box/.test(src), 'Ashby checkbox options group by their enclosing question before input name');
assert(/if \(boxes\.some\(box => box\.checked\)\) continue/.test(src), 'one checked group option satisfies checkbox completeness');
assert(/function segmentedChoiceGroups\(/.test(src) && /segmented-buttons/.test(src), 'Ashby segmented Yes/No buttons are enumerated and bank-routed');
assert(/function segmentedSelectedIndex\(/.test(src) && /\^_active_/.test(src), 'Ashby segmented selection is verified from its active button state');
assert(src.includes('input.files / C:\\fakepath') && !/if \(input\.files\?\.length\) return input\.files\[0\]\.name/.test(src), 'Ashby resume success never trusts input.files or fakepath');
assert(/const name = item\.readFilename\(\);[\s\S]{0,100}if \(name\) return \{ ok: true/.test(src), 'Ashby resume waits for visible filename confirmation');
assert(/optionLabels = boxes\.map/.test(src) && /picker \? picker\(optionLabels\)/.test(src), 'checkbox groups use bank option matching');
assert(/const unansweredRequired = \[\]/.test(src) && /const unansweredOptional = \[\]/.test(src), 'required and optional unanswered controls are tracked separately');
assert(/missing\.length \|\| failures\.length \|\| unansweredRequired\.length/.test(src), 'only unanswered REQUIRED controls block submit');
assert(!/realClick\(button\);\s*try \{ button\.click/.test(src), 'each submit attempt dispatches one click sequence');
assert(/blocked by captcha/.test(src), 'captcha-block status shipped');
assert(/autofill from resume/i.test(src), 'Ashby Autofill-from-resume uploader is excluded');
assert(/const ASHBY_FORM_HOSTS = \['ashbyhq\.com'\]/.test(src), 'all ashbyhq.com hosts route to the Ashby branch');
assert(manifest.host_permissions.includes('https://*.ashbyhq.com/*'), 'manifest grants trusted *.ashbyhq.com host access');
assert(manifest.content_scripts.some(entry => entry.matches?.includes('https://*.ashbyhq.com/*') && entry.all_frames === true), 'manifest injects the Ashby engine on all *.ashbyhq.com frames');
assert(/GH_ARTIFACT_HOSTS = \[[^\]]*'ashbyhq\.com'/.test(backgroundSrc), 'artifact allowlist covers trusted ashbyhq.com subdomains');

console.log('\n=== Ashby screenshots (Notion / SF office, 2026-07-27) ===');
const NOTION_SPONSOR = 'Will you now or in the future require Notion to sponsor an immigration case in order to employ you?';
routes(NOTION_SPONSOR, 'sponsorship');
assert(pick(NOTION_SPONSOR).choose === 'yes', 'company-name sponsorship phrasing -> Yes');
const ANCHOR_DAYS = 'We work from our offices on Mondays, Tuesdays, and Thursdays (Anchor Days). If you need an accommodation, we will partner with you and explore reasonable options consistent with applicable law. Are you able to commit to working from one of our offices on Anchor Days each week?';
routes(ANCHOR_DAYS, 'relocation-hybrid');
assert(pick(ANCHOR_DAYS).choose === 'yes', 'Anchor Days office commitment -> Yes');
const HUB_COMMUTE = 'Do you live within commuting distance to one of our hubs (NY, SF, DC, BOS or London)?';
routes(HUB_COMMUTE, 'relocation-hybrid');
assert(pick(HUB_COMMUTE).choose === 'yes', 'commuting distance to a hub -> Yes');
routes('Do you live within commuting distance of our Chicago office?', 'relocation-hybrid');
assert(pick('Where do you currently live?').topic === 'current-location-text', 'a plain where-do-you-live question still routes to the residence text');
const AUTH_NO_NEED = 'Are you legally authorized to work in the United States without the need for sponsorship now or in the future?';
routes(AUTH_NO_NEED, 'unrestricted-right-to-work');
assert(pick(AUTH_NO_NEED).choose === 'yes', 'authorized without the NEED FOR sponsorship -> Yes');
routes('Do you currently require sponsorship to commence employment?', 'sponsorship-current-commence');

console.log('\n=== Location questions + typeahead flow (screenshots 2026-07-27) ===');
const CITY_STATE_RESIDENCE = 'What is your current city and state of residence?';
routes(CITY_STATE_RESIDENCE, 'current-location-text');
assert(pick(CITY_STATE_RESIDENCE).text === 'Dallas, TX', 'current city and state of residence -> Dallas, TX');
routes('Where are you currently located?', 'current-location-text');
routes('Where do you currently live?', 'current-location-text');
routes('What city and state do you reside in?', 'current-location-text');
// The specific location topics must still win over the broad phrasings added above.
routes('Are you currently located in North America?', 'current-location-north-america');
routes('Are you based in New York or San Francisco?', 'based-in-ny-or-sf');
assert(pick('Where do you plan on working from (for pay transparency)?') === null, 'a "where do you plan to work" question is NOT answered with the residence text');
// Ashby typeahead: click → type → 0.5s → click the FIRST suggestion (never leave typed text).
assert(/function fillTypeaheadCombo\(/.test(src), 'greenhouse.js ships the Ashby typeahead fill');
assert(/resultContainer/.test(src), 'typeahead reads the portal-rendered Ashby result list');
assert(/const GH_SELECTION_SETTLE_MS = 500;/.test(src), 'every single selection is paced by 0.5s');
assert(/function clickAway\(/.test(src) && /async function afterSelection\(/.test(src), 'each single selection is followed by a click away onto empty space');
assert(src.indexOf('// 2) Plain text inputs') < src.indexOf('// 2a) Ashby typeahead comboboxes'), 'plain text fields are filled BEFORE the click-selections');
assert(/typeaheadCombos\(form\)/.test(src) && /missingRequiredControls/.test(src), 'an empty required typeahead counts as a missing required control');

console.log('\n=== Searchable status picker + office cadence (screenshots 2026-07-27) ===');
const AUTH_STATUS = 'What is your current U.S. work authorization status?';
routes(AUTH_STATUS, 'work-auth-status-select');
const authStatus = pick(AUTH_STATUS);
assert(authStatus.search === 'h1', 'the searchable work-auth picker types "h1" to surface the option');
const AUTH_OPTIONS = ['U.S. Citizen', 'Green Card / Permanent Resident', 'H-1B Visa', 'F-1 OPT', 'Will require sponsorship to begin work'];
const authIndex = (() => { for (const c of authStatus.optionCandidates) { const i = AUTH_OPTIONS.findIndex(t => c.test(t)); if (i >= 0) return i; } return -1; })();
assert(AUTH_OPTIONS[authIndex] === 'H-1B Visa', `work-auth picker selects H-1B Visa (got ${AUTH_OPTIONS[authIndex]})`);
assert(/function fillTypeaheadCombo\(item, searchText, picker\)/.test(src), 'the typeahead accepts a banked picker, not just the first suggestion');
const MDR_OFFICE = 'Are you excited to work from our Marina Del Rey, CA office on Mondays and Thursdays (2 days/week)? Choose "yes" if you are willing to commute or relocate.';
assert(pick(MDR_OFFICE)?.choose === 'yes', 'the Marina Del Rey 2-days/week office question -> Yes');
routes('Are you able to work from our Austin office 3 days/week?', 'office-attendance-requirement');

console.log('\n=== Ashby screenshots (locations / LLM / degree / AI essay, 2026-07-27) ===');
const ALL_LOCATIONS = 'Please indicate all of the locations that you would be interested in relocating to for this position.';
routes(ALL_LOCATIONS, 'relocation-locations-all');
assert(pick(ALL_LOCATIONS).checkAll === true, 'every offered relocation location is ticked, not just one');
assert(/if \(entry\.checkAll\)/.test(src), 'greenhouse.js implements the check-every-option branch');
routes('Are you authorized to work lawfully in the United States?', 'work-authorization');
const VISA_TYPE_SPONSORSHIP = 'Will you now or at any time in the future require sponsorship for employment visa status (e.g. H1B, OPT)?';
routes(VISA_TYPE_SPONSORSHIP, 'sponsorship');
const VISA_OPTIONS = ['OPT', 'H1B', 'TN', 'None', 'Other'];
const visaPick = (() => { for (const c of pick(VISA_TYPE_SPONSORSHIP).optionCandidates) { const i = VISA_OPTIONS.findIndex(t => c.test(t)); if (i >= 0) return i; } return -1; })();
assert(VISA_OPTIONS[visaPick] === 'H1B', `visa-type sponsorship list picks H1B (got ${VISA_OPTIONS[visaPick]})`);
const YES_NO = ['Yes', 'No'];
const yesNoPick = (() => { for (const c of pick(VISA_TYPE_SPONSORSHIP).optionCandidates) { const i = YES_NO.findIndex(t => c.test(t)); if (i >= 0) return i; } return -1; })();
assert(YES_NO[yesNoPick] === 'Yes', 'a plain Yes/No sponsorship control still answers Yes');
routes('Do you have experience with LLMs?', 'llm-experience');
routes("Have you built a personal project using LLM's?", 'llm-experience');
assert(pick('Do you have experience with LLMs?').choose === 'yes', 'LLM experience -> Yes');
routes('Degree Type', 'degree');
const DEGREE_BOXES = ['Undergraduate/Bachelors', "Master's", 'PhD', 'MBA'];
const degreePick = (() => { for (const c of pick('Degree Type').optionCandidates) { const i = DEGREE_BOXES.findIndex(t => c.test(t)); if (i >= 0) return i; } return -1; })();
assert(DEGREE_BOXES[degreePick] === "Master's", `Degree Type checkbox list picks Master's (got ${DEGREE_BOXES[degreePick]})`);
const schoolDecision = textFillDecision('School', false);
assert(schoolDecision.kind === 'profile' && schoolDecision.value === 'University at Buffalo', 'School input gets University at Buffalo');
const gradDecision = textFillDecision('Graduation Date', false);
assert(gradDecision.kind === 'profile' && gradDecision.value === '02/01/2022', 'Graduation Date input gets 02/01/2022');
const AI_EXPERIENCE = 'Please describe your AI experience.';
routes(AI_EXPERIENCE, 'ai-experience-essay');
assert(/Google ADK, FastAPI, Azure OpenAI, and AWS Bedrock/.test(pick(AI_EXPERIENCE).text), 'AI experience essay keeps the concrete stack');
routes(AI_USAGE_PROMPT, 'ai-tools-usage-essay');

console.log('\n=== English level + country of residence (screenshots 2026-07-27) ===');
const ENGLISH_LEVEL = "What's your english level?";
routes(ENGLISH_LEVEL, 'english-level');
const CEFR = ['C2: Proficient.', 'C1: Advanced.', 'B2: Upper-Intermediate.', 'B1: Intermediate.', 'A2: Pre-Intermediate.', 'A1: Basic'];
const cefrPick = (() => { for (const c of pick(ENGLISH_LEVEL).optionCandidates) { const i = CEFR.findIndex(t => c.test(t)); if (i >= 0) return i; } return -1; })();
assert(CEFR[cefrPick] === 'C2: Proficient.', `English level picks the C2 option (got ${CEFR[cefrPick]})`);
const LINKEDIN_STYLE_LEVELS = ['Native or Bilingual', 'Full Professional', 'Professional Working', 'Limited Working', 'Elementary'];
const altPick = (() => { for (const c of pick(ENGLISH_LEVEL).optionCandidates) { const i = LINKEDIN_STYLE_LEVELS.findIndex(t => c.test(t)); if (i >= 0) return i; } return -1; })();
assert(LINKEDIN_STYLE_LEVELS[altPick] === 'Native or Bilingual', 'a non-CEFR level list still lands on the highest offered level');
assert(pick('List the top 3 programming languages / platforms that you are most proficient in as well as your length of experience with each')?.topic !== 'english-level', 'the programming-languages question is never treated as an English level');
const COUNTRY_RESIDE = 'In which country do you reside?';
routes(COUNTRY_RESIDE, 'country-of-residence');
assert(pick(COUNTRY_RESIDE).search === 'uni', 'the searchable country list types "uni" to surface United States');
assert(pick(COUNTRY_RESIDE).optionMatch.test('United States') && !pick(COUNTRY_RESIDE).optionMatch.test('United Kingdom'), 'country of residence selects United States, never United Kingdom');

// User-supplied Q&A (2026-07-27): "willing to move to <city>" / "work in person with us" phrasing
// is the same standing relocation rule as "willing to relocate", just worded with "move" instead.
const SF_MOVE_IN_PERSON = 'Are you willing to move to SF and work in person with us?';
routes(SF_MOVE_IN_PERSON, 'relocation-hybrid');
assert(pick(SF_MOVE_IN_PERSON).choose === 'yes', 'willing to move + work in person -> Yes');

console.log('\n=== User-supplied Q&A batch (2026-07-27): SF Bay Area, sponsorship, relocation, Column consent, self-ID, Robinhood COI ===');
const BAY_AREA_Q = 'Do you currently live in the San Francisco Bay Area?';
routes(BAY_AREA_Q, 'bay-area-residency');
assert(pick(BAY_AREA_Q).choose === 'yes', 'Bay Area residency -> Yes');
const NY_OR_SF_Q = 'Are you currently based in New York or San Francisco?';
routes(NY_OR_SF_Q, 'based-in-ny-or-sf');
assert(pick(NY_OR_SF_Q).choose === 'no', 'the combined NY-or-SF question is untouched and still answers No');

const SPONSOR_H1B_Q = 'Will you now or in the future require sponsorship to work in the United States (e.g., H-1B visa)?';
routes(SPONSOR_H1B_Q, 'sponsorship');
assert(pick(SPONSOR_H1B_Q).choose === 'yes', 'H-1B sponsorship phrasing -> Yes (already matched before this change)');

const PRESIDIO_IN_PERSON_Q = 'Are you able to work in-person in San Francisco? (Presidio)';
routes(PRESIDIO_IN_PERSON_Q, 'relocation-hybrid');
assert(pick(PRESIDIO_IN_PERSON_Q).choose === 'yes', 'able to work in-person in SF -> Yes');
const REQUIRE_RELOCATION_Q = 'Will you require relocation?';
routes(REQUIRE_RELOCATION_Q, 'relocation-hybrid');
assert(pick(REQUIRE_RELOCATION_Q).choose === 'yes', 'will you require relocation -> Yes');

const COLUMN_CONSENT_Q = 'Do you agree to allow Column to contact you about job opportunities for up to 2 years? (Recruiting Privacy Policy)';
routes(COLUMN_CONSENT_Q, 'consent-future-opportunities');
assert(optPick('consent-future-opportunities', ['I agree', 'I do not agree']) === 'I agree', 'Column recruiting-contact consent picks I agree, never decline');

const GENDER_IDENTITY_Q = 'What is your gender identity?';
routes(GENDER_IDENTITY_Q, 'gender-identity');
assert(optPick('gender-identity', ['Cisgender man', 'Cisgender woman', 'Non-binary', 'Prefer not to say']) === 'Cisgender man', 'gender identity picks Cisgender man when offered');
assert(optPick('gender-identity', ['Man', 'Woman', 'Non-binary']) === 'Man', 'gender identity falls back to plain Man');

const RACE_Q = 'What is your race or ethnicity?';
routes(RACE_Q, 'race-ethnicity');
assert(optPick('race-ethnicity', ['White', 'Black or African American', 'East Asian', 'South Asian', 'Decline to answer']) === 'East Asian', 'race/ethnicity picks East Asian when offered');
assert(optPick('race-ethnicity', ['White', 'Asian', 'Black or African American']) === 'Asian', 'race/ethnicity falls back to plain Asian');

const MIL_STATUS_Q = 'What is your military status?';
routes(MIL_STATUS_Q, 'veteran');
assert(optPick('veteran', ['I have never served in the military', 'I am a veteran', 'I decline to answer']) === 'I have never served in the military', 'military status picks "never served" when offered');
assert(optPick('veteran', ['I am not a protected veteran', 'I identify as one or more of the classifications of a protected veteran']) === 'I am not a protected veteran', 'military status falls back to not-a-veteran wording');

const DISABILITY_STATUS_Q = 'What is your disability status?';
routes(DISABILITY_STATUS_Q, 'disability');
assert(optPick('disability', ["No, I don't have a disability", 'Yes, I have a disability', "I don't wish to answer"]) === "No, I don't have a disability", 'disability status picks the exact no-disability wording, never decline');
assert(optPick('disability', ['No, I do not have a disability (or history of a disability)', 'Yes, I have a disability']) === 'No, I do not have a disability (or history of a disability)', 'disability status falls back to the original guarded no-disability match');

const LGBTQ_Q = 'Do you identify as part of the LGBTQ+ community?';
routes(LGBTQ_Q, 'lgbtq-identity');
assert(pick(LGBTQ_Q).choose === 'no', 'LGBTQ+ community membership -> No');
assert(optPick('lgbtq-identity', ['Yes', 'No']) === 'No', 'LGBTQ+ Yes/No control picks No');

const ROBINHOOD_COI_Q = "Do you have: a) any Personal/Familial Relationships (current Robinhood employees or employees of Robinhood's vendors); b) any Outside Business Activities that you wish to continue; c) any investment that is greater than 5% of the outstanding shares of a publicly-traded company; d) any investment in a private company that has a business relationship or that is a current competitor of Robinhood; or e) any Intellectual Property Ownership (patents, trademarks, copyrights) that you wish to retain and/or create/develop while at Robinhood?";
routes(ROBINHOOD_COI_Q, 'conflict-of-interest');
assert(pick(ROBINHOOD_COI_Q).choose === 'no', 'Robinhood omnibus conflict-of-interest disclosure -> No');

console.log('\n=== User-supplied Q&A batch 2 (2026-07-27): SMS long-form, level, US Person, hybrid role, startup, built essay, employment, Harvey office/relocation chain ===');
// Pair 1: SMS consent already routed correctly before this round — regression-guard the long-form
// option pick (the RAMP_SMS case above already covers routing; this locks the exact option text).
const SMS_LONGFORM_Q = "Check Yes or No to indicate your agreement to receive text message updates from Acme Corp regarding your job application. Frequency may vary. Message and data rates may apply. Reply STOP to opt out.";
routes(SMS_LONGFORM_Q, 'consent-sms-contact');
assert(optPick('consent-sms-contact', ['Yes - I consent to receiving text messages', 'No - I do not consent to receiving text messages']) === 'No - I do not consent to receiving text messages', 'long-form SMS consent picks the long-form No option');

// Pair 2: experience-level select -> Senior, never Lead; Mid-Level only as a fallback.
const LEVEL_Q = 'Which level best reflects your experience and the role you are looking to step into?';
routes(LEVEL_Q, 'experience-level-select');
const LEVEL_OPTIONS = [
  'Mid-Level — I have solid foundational experience and am looking to grow and deepen my expertise',
  'Senior — I bring strong independent experience and can own work end-to-end with minimal guidance',
  'Lead — I have extensive experience and am ready to drive strategy, mentor others, and operate at a high level of ownership'
];
assert(optPick('experience-level-select', LEVEL_OPTIONS) === LEVEL_OPTIONS[1], 'experience level picks Senior, never Lead');
assert(optPick('experience-level-select', ['Mid-Level — foundational', 'Lead — extensive experience']) === 'Mid-Level — foundational', 'experience level falls back to Mid-Level only when Senior is not offered');
assert(!BANK.find(e => e.topic === 'experience-level-select').optionCandidates.some(c => c.test('Lead — I have extensive experience and am ready to drive strategy, mentor others, and operate at a high level of ownership')), 'experience-level candidates never match the Lead option text');

// Pair 3: US Person / green-card / asylum export-control disclosure -> No, distinct from
// work-authorization / unrestricted-right-to-work, which must remain Yes.
const US_PERSON_Q = "Are you presently a US Person? A \"U.S. Person\" is defined as a: Lawful Permanent Resident: U.S. Citizen OR Legal Immigrant with a 'Green Card', Protected Individual granted asylum or refugee status";
routes(US_PERSON_Q, 'us-person-status');
assert(pick(US_PERSON_Q).choose === 'no', 'US Person status disclosure -> No');
assert(pick('Are you legally authorized to work in the United States?').topic === 'work-authorization' && pick('Are you legally authorized to work in the United States?').choose === 'yes', 'work-authorization is untouched by us-person-status and stays Yes');
assert(pick('Do you have unrestricted work authorization for the United States?').topic === 'unrestricted-right-to-work' && pick('Do you have unrestricted work authorization for the United States?').choose === 'yes', 'unrestricted-right-to-work is untouched by us-person-status and stays Yes');

// Pair 4: hybrid ROLE (no "office" word) with a weekly cadence -> Yes, via relocation-hybrid.
const HYBRID_ROLE_Q = 'This hybrid role involves being in San Carlos, CA, 3 days per week. Please mark Yes that you read, understand, and are able to do this.';
routes(HYBRID_ROLE_Q, 'relocation-hybrid');
assert(pick(HYBRID_ROLE_Q).choose === 'yes', 'hybrid-role weekly-cadence attestation -> Yes');

// Pair 5: startup experience -> Yes; must never fall into prior-employment's "have you worked at" No.
const STARTUP_Q = 'Have you worked at a startup before?';
routes(STARTUP_Q, 'startup-experience');
assert(pick(STARTUP_Q).choose === 'yes', 'startup experience -> Yes (never stolen by prior-employment No)');

// Pair 6: "cool things you've built" essay — distinct from recent-build-essay's "...built recently".
const BUILT_Q = "Tell us about, or post links to some cool things you've built!";
routes(BUILT_Q, 'built-projects-essay');
const builtEssay = pick(BUILT_Q).text;
assert(/Chrome extension/i.test(builtEssay) && /LinkedIn/.test(builtEssay) && /myworkdayjobs/.test(builtEssay), 'built-projects essay names the Chrome extension and LinkedIn/myworkdayjobs');
assert(/rule-based and regex-based matching/i.test(builtEssay) && /add their own custom rules/i.test(builtEssay), 'built-projects essay preserves the matching-engine and custom-rules details');
assert(/configurable delays/i.test(builtEssay) && /don't get suspended/i.test(builtEssay), 'built-projects essay preserves the rate-limit-suspension delay detail');
assert(/walk away/i.test(builtEssay) && /hundreds of submitted applications/i.test(builtEssay), 'built-projects essay preserves the walk-away-and-return detail');
assert(/90%\+/.test(builtEssay), 'built-projects essay preserves the 90%+ automatic-submission result');
assert(pick("What have you built recently?").topic === 'recent-build-essay', 'a "...built recently"-qualified question still routes to recent-build-essay, not built-projects-essay');

// Pair 7: "have you ever been employed...by/at <company> or its subsidiaries" already routed
// correctly before this round — lock the regression.
const EMPLOYED_SUBS_Q = 'Have you ever been employed full-time at Acme Corp or its subsidiaries?';
routes(EMPLOYED_SUBS_Q, 'prior-employment');
assert(pick(EMPLOYED_SUBS_Q).choose === 'no', 'ever-employed-by/at-company-or-subsidiaries -> No');

// Pairs 10/11/12: Harvey office/relocation option chain, all on office-attendance-requirement, ONE
// ordered optionCandidates precedence — relocate options always win; a false "already based in the
// posted location" claim is NEVER picked.
const HARVEY_OFFICE_Q = "Harvey follows a hybrid in-office model - we're in the office three days a week. Are you excited and able to join us in person on those days?";
routes(HARVEY_OFFICE_Q, 'office-attendance-requirement');
const HARVEY_OFFICE_OPTIONS = ["Yes, I'm able to work from the office 3 days a week", 'I may need flexibility and would like to discuss', "No, I'm only able to work remotely"];
assert(optPick('office-attendance-requirement', HARVEY_OFFICE_OPTIONS) === HARVEY_OFFICE_OPTIONS[0], 'Harvey office question (no relocate option) picks the ability-only Yes option');

const HARVEY_WHICH_OFFICE_Q = "Which of Harvey's offices would you be able to work from?";
routes(HARVEY_WHICH_OFFICE_Q, 'office-attendance-requirement');
const HARVEY_WHICH_OFFICE_OPTIONS = ["I'm based in the city this role is posted in and can work from the office", "I'm open to relocating to work from the office"];
assert(optPick('office-attendance-requirement', HARVEY_WHICH_OFFICE_OPTIONS) === HARVEY_WHICH_OFFICE_OPTIONS[1], 'which-office question picks open-to-relocating, never the false based-in-city claim');

const HARVEY_TIED_OFFICE_Q = "This role is tied to the office location listed in the job posting. Team members are expected to work from the office 3 days per week as part of Acme's hybrid work model. Are you currently based in the listed location and able to work in person 3 days per week?";
routes(HARVEY_TIED_OFFICE_Q, 'office-attendance-requirement');
const HARVEY_TIED_OFFICE_OPTIONS = [
  "Yes, I'm based in this location and able to work from the office 3 days per week",
  "No, I'm not based in this location but willing to relocate",
  "No, I'm only able to work remotely",
  'Other (optional context)'
];
assert(optPick('office-attendance-requirement', HARVEY_TIED_OFFICE_OPTIONS) === HARVEY_TIED_OFFICE_OPTIONS[1], 'tied-to-office-location question picks willing-to-relocate, never the false residency claim, remote-only, or Other');
assert(!BANK.find(e => e.topic === 'office-attendance-requirement').optionCandidates.some(c => c.test(HARVEY_TIED_OFFICE_OPTIONS[0])), 'office-attendance-requirement candidates never match the false already-based-in-location option');

// Pairs 8/9: identity profile fields (Legal First and Last Name / Current or Most Recent Employer).
assert(matchProfileField('Legal First and Last Name')?.value === 'Xiaoxiao Lei', 'Legal First and Last Name -> Xiaoxiao Lei');
assert(matchProfileField('Current or Most Recent Employer')?.value === GH_PROFILE.currentCompany, 'Current or Most Recent Employer -> the canonical J.P. Morgan Chase & Co. value');
assert(typeof GH_PROFILE.currentCompany === 'string' && GH_PROFILE.currentCompany.length > 0, 'currentCompany has a single canonical value from the profile');

console.log('\n=== Single-option acknowledgement rule (user, 2026-07-27) ===');
assert(!/if \(isRequiredInput\(input\)\) \{\n\s+const single = await selectShellOption/.test(src), 'the singleton dropdown rule no longer waits for a required marker');
assert(/a dropdown with exactly one\n\s+\/\/ real option is an ACKNOWLEDGEMENT/.test(src), 'a one-option dropdown is selected outright, required or not');
assert(/A LONE checkbox with no bank match is an acknowledgement/.test(src), 'a lone unmatched checkbox is ticked as an acknowledgement');

console.log('\n=== Live Crusoe/Ashby round (2026-07-27) ===');
// Consent radios that live INSIDE the Phone Number field entry: the question text Eve now
// derives is the intro paragraph, and the options come from their wrapping <label>s.
const SMS_INTRO = 'Check Yes or No to indicate your agreement to receive text message updates from Crusoe regarding your job application. Frequency may vary. Message and data rates may apply. Reply STOP to opt out of future messaging. View our privacy policy here: Privacy Policy';
routes(SMS_INTRO, 'consent-sms-contact');
const SMS_OPTIONS = ['Yes - I consent to receiving text messages', 'No - I do not consent to receiving text messages'];
assert(SMS_OPTIONS.find(t => pick(SMS_INTRO).optionMatch.test(t)) === 'No - I do not consent to receiving text messages', 'texting consent picks the long-form No option');
assert(pick('Phone Number') === null, 'the host field label of the Crusoe consent radios matches nothing');
assert(/input\.closest\('label'\)/.test(src), 'option text is read from a wrapping <label> (id-less radios)');
assert(/function radioGroupIntroText\(/.test(src), 'a radio group nested in another field derives its question from the intro text');
assert(/const ACKNOWLEDGEMENT_OPTION =/.test(src), 'an acknowledgement radio option is always selected');

// Profile fields that were missed on live forms.
const legalNameDecision = textFillDecision('First and Last Legal Name', false);
assert(legalNameDecision.kind === 'profile' && legalNameDecision.value === 'Xiaoxiao Lei', '"First and Last Legal Name" fills the full legal name');
const legalNameDecision2 = textFillDecision('Legal First and Last Name', false);
assert(legalNameDecision2.kind === 'profile' && legalNameDecision2.value === 'Xiaoxiao Lei', 'the reversed word order fills the same value');
const zipDecision = textFillDecision('Zip Code', false);
assert(zipDecision.kind === 'profile' && zipDecision.value === '75023', 'Zip Code fills 75023');

// Hub-radius question: never a city, never the unable-to-relocate option.
const HUB = 'We are a flexible remote-first company, but we do require employees to reside within 50 miles of the hub advertised on the job posting for this role. At the time of hire, will you be located within 50 miles of one of our hubs? If so, please select which location.';
routes(HUB, 'hub-location-radius');
const HUB_OPTIONS = ['Los Angeles, CA', 'New York, NY', 'San Francisco, CA', 'Seattle, WA', 'N/A - I am not in one of the hub locations and am unable to relocate', 'N/A - I am not in one of the hub locations but I AM able to relocate'];
const hubPick = (() => { for (const c of pick(HUB).optionCandidates) { const i = HUB_OPTIONS.findIndex(t => c.test(t)); if (i >= 0) return i; } return -1; })();
assert(HUB_OPTIONS[hubPick] === 'N/A - I am not in one of the hub locations but I AM able to relocate', `hub question takes the able-to-relocate option (got ${HUB_OPTIONS[hubPick]})`);

// Work-authorization STATUS list (never the any-employer/citizen option).
const AUTH_COUNTRY = 'Are you currently authorized to work in the country outlined for this job (e.g. H-1B status)?';
routes(AUTH_COUNTRY, 'work-auth-status-select');
const AUTH_COUNTRY_OPTIONS = ['I am authorized to work for any employer in the country outlined in this role (ie: citizen, permanent resident, etc.)', 'My current work authorization requires a renewal or sponsorship now or in the future (ie: H1-B, OPT, TN, etc.)', "My status to work in the country in this role's location is unknown"];
const authPick = (() => { for (const c of pick(AUTH_COUNTRY).optionCandidates) { const i = AUTH_COUNTRY_OPTIONS.findIndex(t => c.test(t)); if (i >= 0) return i; } return -1; })();
assert(/requires a renewal or sponsorship/.test(AUTH_COUNTRY_OPTIONS[authPick]), 'the status list takes the renewal/sponsorship option, never the any-employer one');
routes('Are you legally authorized to work in the country in which the position is located?', 'work-authorization');

// How-heard: LinkedIn when offered, otherwise the first real option.
routes('How did you find us?', 'how-heard');
const HOW_HEARD = pick('How did you hear about Mixpanel as an Employer?');
const withLinkedIn = ['LinkedIn', 'Social Media (Twitter, Facebook, etc.)', 'Glassdoor', 'Indeed'];
const withoutLinkedIn = ['Select...', 'Job board', 'Referral'];
const firstHit = (entry, opts) => { for (const c of entry.optionCandidates) { const i = opts.findIndex(t => c.test(t)); if (i >= 0) return opts[i]; } return null; };
assert(firstHit(HOW_HEARD, withLinkedIn) === 'LinkedIn', 'how-heard prefers LinkedIn');
assert(firstHit(HOW_HEARD, withoutLinkedIn) === 'Job board', 'how-heard otherwise takes the first real option, skipping the placeholder');

// Standing rule: 'do you have N years of experience' is always Yes.
const STACK_YEARS = 'Do you have three or more years of production-level experience with our tech stack? Back end: Node.js, Typescript, MongoDB, OpenAPI, RabbitMQ, Elasticsearch Front end: React, Next.js, Tailwind Infrastructure: AWS, Kubernetes, Docker, Terraform, Kibana';
// The stack list in this one also trips the cloud/containers experience topic — either way the
// answer is Yes, which is what the standing rule requires.
assert(pick(STACK_YEARS).choose === 'yes', 'a years-of-experience threshold question is always Yes');
routes('Do you have 5+ years of experience with distributed systems?', 'years-of-experience-threshold');
assert(pick(STACK_YEARS).choose === 'yes', 'a years-of-experience threshold question is always Yes');
routes('How many years of relevant work experience do you have?', 'years-of-relevant-experience');

// One-sentence proudest-professional answer.
const PROUD_ONE = 'In one sentence, what are you most proud of professionally?';
routes(PROUD_ONE, 'proudest-professional-one-sentence');
const proudOneText = pick(PROUD_ONE).text.replace(/J\.P\./g, 'JP');
assert(/AI agent system/.test(proudOneText) && /\.$/.test(proudOneText.trim()) && !/\.\s+\S/.test(proudOneText.trim()), 'the proudest-professional answer is the AI-agent project in one sentence');

console.log('\n=== Screenshots: hub list / named-weekday office / work-auth radios (2026-07-27) ===');
const HUB_LIST = 'Please select which Taskrabbit hub you are currently based out of:';
routes(HUB_LIST, 'hub-location-radius');
const HUB_LIST_OPTIONS = ['Greater San Francisco Bay Area', 'Greater New York City Area', 'Greater London Area', 'Willing to relocate to one of the above areas', 'Not willing to relocate to any of these areas'];
const hubListPick = (() => { for (const c of pick(HUB_LIST).optionCandidates) { const i = HUB_LIST_OPTIONS.findIndex(t => c.test(t)); if (i >= 0) return i; } return -1; })();
assert(HUB_LIST_OPTIONS[hubListPick] === 'Willing to relocate to one of the above areas', `hub list takes the willing-to-relocate option (got ${HUB_LIST_OPTIONS[hubListPick]})`);
assert(!/^Not willing/.test(HUB_LIST_OPTIONS[hubListPick]), 'the NOT-willing option, which contains the same words, is never selected');
assert(!/Greater/.test(HUB_LIST_OPTIONS[hubListPick]), 'a hub city is never claimed as the current base');

const WEEKDAY_OFFICE = 'Our team leverages in-office time to maximize creative collaboration and team synergy. Are you able to join us in the office every Tuesday and Wednesday as part of our hybrid model?';
assert(pick(WEEKDAY_OFFICE) && pick(WEEKDAY_OFFICE).choose === 'yes', 'named-weekday in-office question -> Yes');

const AUTH_RADIOS = 'U.S. Work Authorization Status';
routes(AUTH_RADIOS, 'work-auth-status-select');
const AUTH_RADIO_OPTIONS = ['Can work for any employer', 'Can work for current employer', 'Seeking work authorization'];
const authRadioPick = (() => { for (const c of pick(AUTH_RADIOS).optionCandidates) { const i = AUTH_RADIO_OPTIONS.findIndex(t => c.test(t)); if (i >= 0) return i; } return -1; })();
assert(AUTH_RADIO_OPTIONS[authRadioPick] === 'Can work for current employer', `work-auth radios take the current-employer option (got ${AUTH_RADIO_OPTIONS[authRadioPick]})`);

console.log('\n=== Screenshots: veteran branch / required location / AI systems (2026-07-27) ===');
const VET_BRANCH = 'Veteran Branch of Service';
const VET_OPTIONS = ['I am not a Veteran', 'Air Force', 'Army', 'Coast Guard', 'Marines', 'Navy', 'Other', 'Prefer not to say', "I don't wish to answer"];
const vetBranchEntry = pick(VET_BRANCH);
const vetPick = (() => { const cands = vetBranchEntry.optionCandidates || [vetBranchEntry.optionMatch]; for (const c of cands) { const i = VET_OPTIONS.findIndex(t => c.test(t)); if (i >= 0) return i; } return -1; })();
assert(VET_OPTIONS[vetPick] === 'I am not a Veteran', `branch-of-service list takes "I am not a Veteran" (got ${VET_OPTIONS[vetPick]})`);
assert(!/prefer not|wish to answer/i.test(VET_OPTIONS[vetPick]), 'the branch list never declines to answer');

const REQUIRED_LOCATION = 'Are you willing to work from the required location?';
assert(pick(REQUIRED_LOCATION) && pick(REQUIRED_LOCATION).choose === 'yes', 'willing to work from the required location -> Yes');

const AI_TOOLS_WHAT = 'What AI tools are you currently using today and how are you using them?';
routes(AI_TOOLS_WHAT, 'ai-tools-usage-essay');
assert(/Claude, Codex, and GitHub Copilot/.test(pick(AI_TOOLS_WHAT).text), 'the AI-tools answer names the tools actually used');
assert(/integration tests/.test(pick(AI_TOOLS_WHAT).text), 'the AI-tools answer keeps the concrete integration-test example');

const YEARS_SWE = 'How many years of experience do you have in software engineering?';
routes(YEARS_SWE, 'years-of-relevant-experience');
assert(pick(YEARS_SWE).text === '5', 'a free-text years-of-experience field is answered with 5');

const AI_SYSTEMS = 'This is an AI systems engineering role — we want someone who builds reliable production systems around modern foundation models, not someone who trains models from scratch. What AI systems have you built?';
routes(AI_SYSTEMS, 'ai-systems-built-essay');
const aiSystemsText = pick(AI_SYSTEMS).text;
assert(/Google ADK|Azure OpenAI|AWS Bedrock/.test(aiSystemsText), 'the AI-systems answer names the real stack');
assert(/schema-constrained|human-review|validation/i.test(aiSystemsText), 'the AI-systems answer speaks to reliability, which is what the question asks');
assert(/not trained foundation models from scratch/i.test(aiSystemsText), 'the AI-systems answer is honest about not training models from scratch');
routes('Please describe your AI experience.', 'ai-experience-essay');

console.log('\n=== Conditional commute vs residency (2026-07-27) ===');
// A CONDITIONAL commute question is about ability, not residency: it must never inherit the
// honest No from the are-you-based-there topic.
const CONDITIONAL_COMMUTE = 'If you are based in San Francisco, Salt Lake City, or New York City, are you able to commute to the office three days per week?';
assert(pick(CONDITIONAL_COMMUTE) && pick(CONDITIONAL_COMMUTE).choose === 'yes', 'conditional commute question -> Yes');
assert(pick(CONDITIONAL_COMMUTE).topic !== 'based-in-ny-or-sf', 'the conditional commute question is not answered by the residency topic');
const LOCATION_REQUIREMENTS = 'Are you able to meet the location requirements of the position as stated in the job description?';
assert(pick(LOCATION_REQUIREMENTS) && pick(LOCATION_REQUIREMENTS).choose === 'yes', 'meeting the location requirements -> Yes');
// The genuine residency question keeps its honest No.
routes('Are you currently based in New York or San Francisco?', 'based-in-ny-or-sf');
assert(pick('Are you currently based in New York or San Francisco?').choose === 'no', 'a plain are-you-based-there question is still answered No');
const preferredPhone = textFillDecision('Preferred phone number', false);
assert(preferredPhone.kind === 'profile' && preferredPhone.value === '(571) 376-1882', '"Preferred phone number" fills the phone');
const preferredFirst = textFillDecision('Preferred First Name', false);
assert(preferredFirst.kind === 'profile' && preferredFirst.value === 'Xiaoxiao', 'the phone pattern does not steal Preferred First Name');

console.log('\n=== Education level, GPA, relocation assistance (2026-07-27) ===');
const EDU_LEVEL = 'What is your highest completed level of education?';
routes(EDU_LEVEL, 'degree');
assert(optPick('degree', ['High School', "Associate's Degree", "Bachelor's Degree", "Master's Degree"]) === "Master's Degree", 'highest level of education -> Master\'s Degree');

// relocation ASSISTANCE is a different question from willingness to relocate: the applicant
// relocates on their own and asks the company for nothing.
const RELO_ASSIST = 'If you are not currently based in the SF Bay Area, will you require relocation assistance?';
routes(RELO_ASSIST, 'relocation-assistance');
assert(pick(RELO_ASSIST).choose === 'no', 'relocation assistance -> No');
routes('Will you need assistance with relocation?', 'relocation-assistance');
assert(pick('Are you willing to relocate?') && pick('Are you willing to relocate?').choose === 'yes', 'willingness to relocate is still Yes');

const GPA = "Please provide your GPA for each degree you've obtained.";
routes(GPA, 'gpa');
assert(pick(GPA).text === '3.65', 'GPA -> 3.65');
assert(pick(GPA).requiredOnly === true, 'GPA is only filled when the field is required');
assert(/entry\.requiredOnly && !isRequiredInput\(input\)/.test(src), 'greenhouse.js skips requiredOnly answers on optional fields');

console.log('\n=== Affirm/Greenhouse round (2026-07-28) ===');
const STATE_PROVINCE = 'Which U.S. State or Canadian Province do you reside in?';
routes(STATE_PROVINCE, 'state');
assert(optPick('state', ['Alabama', 'Texas', 'Ontario']) === 'Texas', 'state list -> Texas');
assert(pick(STATE_PROVINCE).search === 'texas', 'the searchable state list types "texas"');
// A question naming the city as well still wants the combined city+state answer.
routes('What is your current city and state of residence?', 'current-location-text');

routes('How did you first learn about Affirm as an employer?', 'how-heard');

const PRIOR_LONGFORM = 'Have you previously been employed at Affirm for any length of time?';
routes(PRIOR_LONGFORM, 'prior-employment');
assert(optPick('prior-employment', ['I have previously been employed at Affirm', 'I have not previously been employed at Affirm']) === 'I have not previously been employed at Affirm', 'long-form prior-employment option -> the have-not option');
assert(optPick('prior-employment', ['I have never worked for SpaceX, xAI, X, or Twitter', 'I currently work for xAI']) === 'I have never worked for SpaceX, xAI, X, or Twitter', 'the never-worked option still wins where both exist');

// Second education entry takes the list's own Other option, never the real undergrad name.
assert(/schoolOther: true/.test(src), 'the second education entry is flagged to use Other');
assert(/schoolSearch: 'other'/.test(src), 'the second education entry searches "other"');
assert(!/schoolSearch: 'Beijing International'/.test(src), 'the undergrad name is no longer searched');

console.log('\n=== Work-location choice: all when multi, precedence when single (2026-07-28) ===');
routes('Preferred Work Location', 'relocation-locations-all');
routes('Which office would you prefer to work from?', 'relocation-locations-all');
assert(pick('Preferred Work Location').checkAll === true, 'a multi-select work-location question ticks every office');
// Single-choice lists fall back to the reasoned precedence on the same entry.
assert(optPick('relocation-locations-all', ['San Francisco HQ', 'New York City Office', 'Seattle Office']) === 'San Francisco HQ', 'single choice -> San Francisco first');
assert(optPick('relocation-locations-all', ['New York City Office', 'Seattle Office']) === 'Seattle Office', 'single choice -> Seattle over New York');
assert(optPick('relocation-locations-all', ['Open to relocating', 'San Francisco HQ']) === 'Open to relocating', 'an option committing to nothing geographic wins');
assert(optPick('relocation-locations-all', ['Remote', 'San Francisco HQ']) === 'San Francisco HQ', 'Remote is a fallback, not a preference');
assert(optPick('relocation-locations-all', ['Select...', 'Prefer not to say', 'London']) === 'London', 'a real option beats a placeholder or a decline');
// Ability questions stay with the office-attendance affirmative.
routes("Which of Harvey's offices would you be able to work from?", 'office-attendance-requirement');
routes('Are you able to work from our Austin office 3 days/week?', 'office-attendance-requirement');

console.log('\n=== Onsite-schedule question, artifacts and tech list (2026-07-28) ===');
const POTRERO = 'This position is based onsite at our Potrero Hill office in San Francisco, 4\u20135 days per week. Are you currently located in the Bay Area and open to this schedule?';
routes(POTRERO, 'office-attendance-requirement');
const POTRERO_OPTIONS = ["Yes, I'm currently in the Bay Area and open to 4\u20135 days onsite", "I'm not currently in the Bay Area but am open to relocation and 4-5 days onsite", 'No, I am looking for remote opportunities'];
const potreroPick = (() => { for (const c of pick(POTRERO).optionCandidates) { const i = POTRERO_OPTIONS.findIndex(t => c.test(t)); if (i >= 0) return i; } return -1; })();
assert(/not currently in the Bay Area but am open to relocation/.test(POTRERO_OPTIONS[potreroPick]), 'the onsite-schedule question takes the relocation option, never the false residency claim');
// The plain residency question keeps its own answer.
routes('Do you currently live in the San Francisco Bay Area?', 'bay-area-residency');

const TECH_LIST = 'What are the main programming languages and technologies you\u2019ve worked with in your previous roles?';
routes(TECH_LIST, 'languages-technologies-list');
assert(pick(TECH_LIST).text === 'Python, Java, TypeScript, SQL', 'the technologies list answer');
assert(pick('List the top 3 programming languages / platforms that you are most proficient in as well as your length of experience with each')?.topic !== 'languages-technologies-list', 'the with-years variant is not claimed by the plain list topic');
assert(pick('Are you willing to work in the office 5-days a week?')?.choose === 'yes', 'willing to work in the office 5 days a week -> Yes');

// Packaged documents are resolved by name pattern, not a hardcoded filename.
const backgroundSource = fs.readFileSync(path.join(__dirname, '..', 'eve', 'background.js'), 'utf8');
assert(/ARTIFACT_NAME_RE/.test(backgroundSource), 'artifacts are matched by filename pattern (resume / letter)');
assert(/if \(!CONFIGURED_ARTIFACTS\) await loadLocalProfile\(\)/.test(backgroundSource), 'a restarted service worker re-reads the profile before serving an artifact');
assert(/artifactCandidates/.test(backgroundSource), 'several candidate paths are tried before giving up');

console.log('\n=== Structure ===');
const topics = BANK.map(e => e.topic);
const dupes = topics.filter((t, i) => topics.indexOf(t) !== i);
assert(dupes.length === 0, `no duplicate topics (${topics.length} gh topics)${dupes.length ? ' dupes=' + dupes : ''}`);
assert(BANK.every(e => Array.isArray(e.patterns) && e.patterns.length), 'every entry has patterns');
assert(BANK.every(e => e.choose || e.text != null || e.optionMatch || e.optionCandidates || e.checkAll || e.check || e.profileKey || e.optionMatchAll), 'every entry has an answer (choose/text/optionMatch/optionCandidates/optionMatchAll/checkAll/check/profileKey)');

console.log(`\nTOTAL ${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILURES` : ''}`);
process.exit(fail ? 1 : 0);
