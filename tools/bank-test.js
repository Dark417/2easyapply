// Verify the Workday question bank by EXTRACTING the real arrays from eve/workday.js and replaying
// runRegexChoiceStep's entry-selection rule against real question text.
//
// WHY EXTRACT RATHER THAN RETYPE: on 2026-07-25 a heredoc escaping slip wrote a literal backspace
// (0x08) instead of the two characters `\b` into several bank regexes — one of which had already
// shipped. Hand-typed tests "passed" because they tested the retyped regex, not the file. Only
// extraction catches that class of bug. Never copy a regex into a test; always read it from source.
//
// Usage: node tools/bank-test.js
const fs = require('fs');
const path = require('path');

const WORKDAY = path.join(__dirname, '..', 'eve', 'workday.js');
const src = fs.readFileSync(WORKDAY, 'utf8');

// Guard: no stray control characters anywhere in the source (the 0x08 class of bug).
const controlChars = [...src].filter(ch => {
  const code = ch.charCodeAt(0);
  return code < 32 && ch !== '\n' && ch !== '\r' && ch !== '\t';
});

// Pull out simple `const NAME = '...';` scalars the bank arrays reference.
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
  // Literals only (regex/string/bool) plus the scalars bound above.
  return eval(`(function(SALARY_EXPECTATION){ return ${src.slice(open, end + 1)}; })(${JSON.stringify(SALARY_EXPECTATION)})`);
}

const APP = extractArray('DEFAULT_APPLICATION_QUESTIONS');
const VOL = extractArray('DEFAULT_VOLUNTARY_DISCLOSURES');
// combinedChoiceEntries(): application questions first, then disclosures.
const BANK = [...APP.map(e => ({ ...e, _src: 'app' })), ...VOL.map(e => ({ ...e, _src: 'vol' }))];

// Same rule as runRegexChoiceStep: first entry whose patterns match and whose exclude does not.
const pick = text => BANK.find(e =>
  !(e.exclude && e.exclude.test(text)) && e.patterns.some(r => r.test(text))) || null;

let pass = 0, fail = 0;
const assert = (ok, label) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };
const routes = (text, topic) => assert(
  (pick(text)?.topic ?? '(none)') === topic,
  `${topic.padEnd(34)} <- ${text.slice(0, 62)}${(pick(text)?.topic ?? '(none)') === topic ? '' : `   [got ${pick(text)?.topic ?? '(none)'}]`}`);

console.log('=== Source hygiene ===');
assert(controlChars.length === 0, `no stray control chars in workday.js (found ${controlChars.length})`);
assert(SALARY_EXPECTATION === '160000', `SALARY_EXPECTATION constant resolves (${SALARY_EXPECTATION})`);

console.log('\n=== Visa (REF084823W) ===');
routes('Can you provide verification of your identify upon hire?', 'work-eligibility-verification');
routes('Are you legally eligible to work in the job’s location?', 'work-authorization');
routes('In order to begin or continue employment in the United States, will you now or in the future require sponsorship or assistance? (This includes support such as; J-1, F-1, CPT, or OPT and employment based sponsorship such as; H-1B, H-1B1, E-3, O-1, TN, and any EAD card holders that may need assistance)', 'sponsorship');
routes('Are you a military spouse?', 'spouse-military-service');
routes('Are you currently a member of the U.S. National Guard or Reserves?', 'military-service');
routes('I agree that Visa may reach out to me via SMS regarding my application and candidate experience. Message and data rates may apply. I can opt-out at any time.', 'consent-sms-contact');
routes('Visa may use automated tools such as AI to support review of your application for this role, and if applicable, match you with relevant existing and future open roles. If you prefer not to have your application processed by these tools, you can opt-out.', 'consent-ai-screening');
routes('Have you ever worked for Visa Inc. or any wholly/majority-owned subsidiaries of Visa Inc. (e.g., CyberSource, Fundamo, etc.) in any capacity?', 'prior-employment');
routes('Base salary expectation per year.', 'salary-expectation');

console.log('\n=== Regression: previously banked questions ===');
routes('Are you able to perform the essential functions of the job for which you are applying with or without reasonable accommodation?', 'essential-functions');
routes('Are you currently an employee of a Hitachi Group company?', 'current-employee-of-company');
routes('Are you a prior employee of a Hitachi Group company?', 'prior-employment');
routes('Would you consider relocating, either now or in the future?', 'relocation-consider');
routes('How many years of relevant work experience do you have?', 'years-of-relevant-experience');
const POSITION_YOE = 'How many years of relevant work experience do you have for this position?';
routes(POSITION_YOE, 'years-of-relevant-experience-position');
const positionYoe = pick(POSITION_YOE);
assert(positionYoe.optionMatch.test('4 - 6 YoE'), 'position-specific YOE picks 4 - 6 YoE');
assert(!positionYoe.optionMatch.test('5 to 7 Years of Experience'), 'position-specific YOE rejects the generic 5-to-7 band');
routes('List the top 3 programming languages / platforms that you are most proficient in as well as your length of experience with each', 'top-programming-languages');
routes('Do you have any relatives (1) or persons in any other Covered Relationships (2) that are part of Citi’s (3) Senior Management (4)?', 'citi-relatives-senior-management');
routes('Will you now or in the future require sponsorship for employment visa status with Bank of America as your employer', 'sponsorship');
routes('Will you now or in the future require sponsorship for employment visa status?', 'sponsorship');
routes('Are you legally authorized to work in the United States and are you able to present the proper documentation of employment eligibility upon your date of hire?', 'work-authorization');
const RESTRICTED_COUNTRY_CITIZENSHIP = 'Certain U.S. government contracts supported by our company prohibit employment of individuals who hold citizenship (including dual citizenship) in specific countries designated by the U.S. Department of State. Please indicate whether you currently hold citizenship (including dual citizenship) in any of the following countries:';
routes(RESTRICTED_COUNTRY_CITIZENSHIP, 'restricted-country-citizenship');
routes('A government contract prohibits employment based on citizenship in listed countries. Please indicate whether you hold citizenship in any listed country.', 'restricted-country-citizenship');
const restrictedCountryCitizenship = pick(RESTRICTED_COUNTRY_CITIZENSHIP);
assert(restrictedCountryCitizenship.optionMatch.test('I do not hold citizenship in any of the countries listed'), 'restricted-country citizenship picks the explicit none-listed option');
assert(!restrictedCountryCitizenship.optionMatch.test('People’s Republic of China'), 'restricted-country citizenship rejects the prior inferred PRC option');
routes('Do you have the unrestricted right to work in the country?', 'unrestricted-right-to-work');
assert(pick('Do you have the unrestricted right to work in the country?').choose === 'yes', 'unrestricted-right-to-work uses the user-overridden Yes answer');
routes('Has your spouse or domestic partner ever served in the U.S. Military?', 'spouse-military-service');
routes('Do you currently or have you ever served in the U.S. Military?', 'military-service');
routes('Do you consent to the use of your personal information for future job opportunities?', 'consent-future-opportunities');
routes('Were you a partner and/or have you ever been employed by KPMG LLP and/or its members and affiliates worldwide in the last three (3) years?', 'kpmg-employment');
const PREVIOUSLY_EMPLOYED_WITH_US = 'Have you been previously employed with us?';
routes(PREVIOUSLY_EMPLOYED_WITH_US, 'prior-employment');
assert(pick(PREVIOUSLY_EMPLOYED_WITH_US).choose === 'no', 'been-previously-employed wording -> No');

console.log('\n=== Topgolf screenshot (2026-07-27) ===');
const TOPGOLF_AUDIT = 'Are you currently, or have you ever been, a partner, principal, shareholder or employee of Deloitte & Touche LLP or any of its subsidiaries or affiliates (collectively, Deloitte)?';
routes(TOPGOLF_AUDIT, 'audit-firm-affiliation');
assert(pick(TOPGOLF_AUDIT).choose === 'no', 'Deloitte affiliation -> No');
routes('What is your desired salary?', 'salary-expectation');
assert(pick('What is your desired salary?').text === '160000', 'Topgolf desired salary -> 160000');
routes('Are you currently legally authorized to work for Topgolf Callaway Brands in the United States?', 'work-authorization');
assert(pick('Are you currently legally authorized to work for Topgolf Callaway Brands in the United States?').choose === 'yes', 'Topgolf work authorization -> Yes');
routes('Will you now or in the future require Topgolf Callaway Brands sponsorship or support to ensure your continued eligibility to work lawfully for Topgolf Callaway Brands?', 'sponsorship');
assert(pick('Will you now or in the future require Topgolf Callaway Brands sponsorship or support to ensure your continued eligibility to work lawfully for Topgolf Callaway Brands?').choose === 'yes', 'Topgolf sponsorship -> Yes');
const AGE_MAJORITY_CONTRACT = 'Are you at least the age of majority under applicable law (i.e., age 18 in most states, but age 19 in Alabama and Nebraska) and have the right to contract in your own name?';
routes(AGE_MAJORITY_CONTRACT, 'age');
assert(pick(AGE_MAJORITY_CONTRACT).choose === 'yes', 'age of majority + right to contract -> Yes');
routes('Are you at least 18 years of age?', 'age');
assert(pick('Are you at least 18 years of age?').choose === 'yes', 'ordinary minimum-age wording remains Yes');
// User example (2026-07-27): registered as topic "age", matched by pattern for ANY minimum.
routes('Are you at least 18 years old?', 'age');
assert(pick('Are you at least 18 years old?').choose === 'yes', 'Are you at least 18 years old? -> Yes');
routes('Are you at least 21 years of age?', 'age');
routes('Must be 18 years or older. Do you meet this requirement?', 'age');
routes('Are you of legal working age?', 'age');

console.log('\n=== VeriPark screenshot (2026-07-27) ===');
const VERIPARK_PRIOR = 'Have you applied with VeriPark previously?';
routes(VERIPARK_PRIOR, 'prior-application');
assert(pick(VERIPARK_PRIOR).choose === 'no', 'VeriPark prior application -> No');
const VERIPARK_MONTHLY = 'What is your desired Monthly Salary?';
routes(VERIPARK_MONTHLY, 'salary-monthly');
assert(pick(VERIPARK_MONTHLY).text === '12000', 'VeriPark monthly salary -> 12000');
routes('Please select the currency', 'salary-currency');
assert(pick('Please select the currency').optionMatch.test('USD'), 'salary currency -> USD');
assert(!pick('Please select the currency').optionMatch.test('EUR'), 'salary currency rejects EUR');
routes('Do you have Banking/BFSI domain experience?', 'banking-bfsi-experience');
assert(pick('Do you have Banking/BFSI domain experience?').choose === 'yes', 'Banking/BFSI experience -> Yes');
routes('Are you legally permitted to work in the country where this job is located?', 'work-authorization');
assert(pick('Are you legally permitted to work in the country where this job is located?').choose === 'yes', 'legally permitted to work -> Yes');
const VERIPARK_YEARS = 'How many years of experience do you have in the field described in the job description you are applying for?';
routes(VERIPARK_YEARS, 'years-experience-field-described');
assert(pick(VERIPARK_YEARS).text === '5', 'described-field experience -> 5');
const VERIPARK_ACK = 'I understand and acknowledge the terms of use for VeriPark';
routes(VERIPARK_ACK, 'acknowledgement-generic');
assert(pick(VERIPARK_ACK).optionMatch.test('Yes'), 'generic acknowledgement -> Yes');
const selectOptionSource = src.slice(src.indexOf('async function selectOption('), src.indexOf('function ownedOptionList('));
assert(selectOptionSource.indexOf('selectCustomDropdownOption(') < selectOptionSource.indexOf('input[type="checkbox"]'), 'Workday choice precedence tries dropdown before checkbox');

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
routes(RAMP_RELOCATE_OR_BASED, 'relocation-consider');
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
assert(/input\[type=\"checkbox\"\]/.test(src.slice(src.indexOf('async function selectOption'), src.indexOf('function blockRequired'))), 'single-choice selector supports label-matched checkboxes');
const MULTI_CITY_OFFICE = 'Are you willing to work either out of our NYC office or San Francisco office 2-3 days per week?';
routes(MULTI_CITY_OFFICE, 'office-attendance-requirement');
assert(pick(MULTI_CITY_OFFICE).choose === 'yes', 'multi-city recurring office attendance -> Yes');
routes('Can you work from our Chicago office four days a week?', 'office-attendance-requirement');
routes('Would you be comfortable coming on-site in Boston 1 day per week?', 'office-attendance-requirement');
routes('Have you read the privacy policy?', 'privacy-notice-acknowledgement');
assert(pick('Have you read the privacy policy?').optionMatch.test('Yes'), 'privacy-policy read acknowledgement -> Yes');
assert(pick(REL_LOCATION).text === 'Dallas, TX', 'current location -> Dallas, TX');
const REL_REMOTE_STATES = 'If applying to Remote US location, what state(s) are you able to work in?';
routes(REL_REMOTE_STATES, 'remote-us-work-states');
assert(pick(REL_REMOTE_STATES).text === 'CA, WA, TX', 'remote work states -> CA, WA, TX');
routes('Are you legally authorized to work in the country in which the job you are applying for is located?', 'work-authorization');
const REL_SPONSORSHIP = 'Do you now or will you in the future require sponsorship for employment for the location that you are applying to? If so, please explain.';
routes(REL_SPONSORSHIP, 'sponsorship-combined-explanation');
assert(pick(REL_SPONSORSHIP).text === 'Yes, H1b transfer.', 'combined sponsorship explanation uses screenshot answer');
routes('Are you subject to any restrictive covenant or non-competition agreement that may affect your ability to work for Relativity?', 'restrictive-agreements');
const REL_SALARY = 'My realistic base gross annual salary expectation (not including bonus/commission) for my next role is:';
routes(REL_SALARY, 'salary-range-expectation');
const relSalary = pick(REL_SALARY);
assert(relSalary.optionMatch.test('$160,000 - $180,000'), 'salary range picks $160,000 - $180,000');
assert(!relSalary.optionMatch.test('$140,000 - $160,000'), 'salary range rejects adjacent lower band');
const REL_ACCURACY = 'I confirm that my answers to questions in this online application are complete and accurate and that Relativity may rely on my answers. Permission is granted to Relativity to verify all statements in this online application';
routes(REL_ACCURACY, 'acknowledge-answers-truthful');
assert(pick(REL_ACCURACY).choose === 'yes', 'application accuracy confirmation -> Yes');
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
  assert(entry.optionMatch.test(wanted), `${topic} picks ${wanted}`);
  assert(!entry.optionMatch.test(rejected), `${topic} rejects ${rejected}`);
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

console.log('\n=== Salary: fills expectation questions, skips current-salary and hourly ===');
for (const [text, shouldFill] of [
  ['Base salary expectation per year.', true],
  ['What are your salary expectations?', true],
  ['Expected salary', true],
  ['Desired salary for this role', true],
  ['Salary requirements', true],
  ['Compensation expectations (annual)', true],
  ['What is your current salary?', false],
  ['Please provide your current compensation', false],
  ['What was your last salary?', false],
  ['Salary history', false],
  ['Desired hourly rate', false],
  ['Expected salary per hour', false],
  ['What is your expected hourly rate?', false]
]) {
  const got = pick(text)?.topic === 'salary-expectation';
  assert(got === shouldFill, `salary ${shouldFill ? 'fills' : 'skips'}: ${text}${got && !shouldFill ? '  <-- WRONGLY FILLED' : ''}`);
}
assert(BANK.find(e => e.topic === 'salary-expectation').text === '160000', 'salary answer resolves to 160000');
assert(/text: SALARY_EXPECTATION/.test(src), 'salary entry references the constant, not an inline number');

console.log('\n=== Consents: SMS Opt-Out, AI Opt-In (deliberately different) ===');
const sms = BANK.find(e => e.topic === 'consent-sms-contact');
const ai = BANK.find(e => e.topic === 'consent-ai-screening');
assert(sms.optionMatch.test('Opt-Out'), 'SMS picks Opt-Out');
assert(!sms.optionMatch.test('Opt-In'), 'SMS rejects Opt-In');
assert(!sms.optionMatch.test('Select One'), 'SMS rejects Select One');
assert(ai.optionMatch.test('Opt-In'), 'AI picks Opt-In');
assert(!ai.optionMatch.test('Opt-Out'), 'AI rejects Opt-Out');
assert(!ai.optionMatch.test('Select One'), 'AI rejects Select One');
assert(sms.optionLabel !== ai.optionLabel, 'the two consents resolve to DIFFERENT answers (makes cross-talk detectable)');

console.log('\n=== Morgan Stanley set (finance-tenant wording; answers are the user\'s own) ===');
const MS = {
  q1: 'Are you legally authorized to work for Morgan Stanley in the country in which the job is located?',
  q2: 'Do you currently require Morgan Stanley to sponsor a work visa on your behalf to commence employment?',
  q3: 'Will you in the future require sponsorship for employment visa status?',
  q4: 'Are you currently, were you previously, or have you ever attempted to become, registered in the securities industry?',
  q5: 'Are you currently, or have you been in the past three years, a Government Official [1], including military and/or law enforcement, or employed by a financial regulator?',
  q6: 'In a capacity as a Government Official or employee of a financial regulator, have you had the ability to directly or indirectly influence the award of business to Morgan Stanley and/or exercise decision making authority that impacts Morgan Stanley?',
  q7: 'On the basis of employment as a Government Official or employee of a financial regulator, are you subject to any post-employment restrictions (including, but not limited to, cooling off period, non-disclosure of confidential information, recusal requirements, etc.)?',
  q8: 'Are you an Immediate Family Member or Close Associate of any Government Official who has the ability to directly or indirectly influence the award of business to Morgan Stanley and/or exercise decision making authority that impacts Morgan Stanley?',
  q9: 'Were you referred or recommended for this position by a Government Official?',
  q10: 'Do you consent to receive follow up communication via SMS WhatsApp from Talent Acquisition regarding job opportunities at Morgan Stanley?'
};
routes(MS.q1, 'work-authorization');
routes(MS.q2, 'sponsorship-current-commence');
routes(MS.q3, 'sponsorship');
routes(MS.q4, 'securities-registration');
routes(MS.q5, 'government-employment');
routes(MS.q6, 'gov-influence-business');
routes(MS.q7, 'post-employment-restrictions-subject');
routes(MS.q8, 'gov-family-associate');
routes(MS.q9, 'gov-referral');
routes(MS.q10, 'consent-sms-contact');

console.log('\n--- answers each resolves to ---');
const answerOf = e => e ? (e.text !== undefined ? `text:${e.text}` : (e.optionLabel || (e.choose === 'no' ? 'No' : 'Yes'))) : '(none)';
for (const [k, want] of [['q1','Yes'],['q2','No'],['q3','Yes'],['q4','No'],['q5','No'],['q6','No'],['q7','No'],['q8','No'],['q9','No'],['q10','No / Opt-Out']]) {
  assert(answerOf(pick(MS[k])) === want, `${k} answers ${want} (got ${answerOf(pick(MS[k]))})`);
}

console.log('\n--- (A) sponsorship split: all three directions ---');
assert(pick(MS.q2).choose === 'no', 'Q2 "currently … to commence employment" -> No');
assert(pick(MS.q3).topic === 'sponsorship' && pick(MS.q3).choose === 'yes', 'Q3 "in the future" -> Yes');
const combined = 'Will you now or in the future require sponsorship for employment visa status with Bank of America as your employer';
assert(pick(combined).topic === 'sponsorship', 'combined "now or in the future" still -> generic sponsorship (Yes), unchanged');
assert(pick(combined).topic !== 'sponsorship-current-commence', 'combined phrasing NOT stolen by the currently/commence entry');
assert(pick('Do you now or will you in the future require sponsorship of a visa?').topic === 'sponsorship', 'T-Mobile combined phrasing still -> generic sponsorship');

console.log('\n--- (B) post-employment restrictions: opposite polarity preserved ---');
const attestation = 'I attest that I have no post-government employment restrictions that would prevent me from performing this role';
assert(pick(attestation).topic === 'post-government-restrictions', 'attestation form still -> post-government-restrictions');
assert(pick(attestation).choose === 'yes', 'attestation still answers Yes');
assert(pick(MS.q7).choose === 'no', 'Q7 "are you subject to…" answers No (opposite polarity)');
assert(pick(MS.q7).topic !== 'post-government-restrictions', 'Q7 not captured by the attestation topic');

console.log('\n--- (C)/(D) government-official siblings each route to their own topic ---');
assert(pick(MS.q5).topic !== pick(MS.q6).topic, 'Q5 and Q6 are different topics');
assert(pick(MS.q6).topic !== pick(MS.q8).topic, 'Q6 and Q8 are different topics (near-identical strings)');
assert(pick(MS.q9).topic !== 'referral-status', 'Q9 (by a Government Official) not confused with plain referral-status');
assert(pick('Were you referred to Bank of America for employment opportunities?').topic === 'referral-status', 'plain referral question still -> referral-status');

console.log('\n--- (E) consent-sms-contact handles BOTH vocabularies ---');
const smsEntry = BANK.find(e => e.topic === 'consent-sms-contact');
assert(smsEntry.optionMatch.test('Opt-Out'), 'SMS picks Opt-Out (Visa vocabulary)');
assert(smsEntry.optionMatch.test('No'), 'SMS picks No (Morgan Stanley vocabulary)');
assert(!smsEntry.optionMatch.test('Opt-In'), 'SMS rejects Opt-In');
assert(!smsEntry.optionMatch.test('Yes'), 'SMS rejects Yes');
assert(!smsEntry.optionMatch.test('None of the above'), 'SMS "No" anchor does not hit "None of the above"');
assert(!smsEntry.optionMatch.test('Not interested'), 'SMS "No" anchor does not hit "Not interested"');
assert(pick('I agree that Visa may reach out to me via SMS regarding my application and candidate experience.').topic === 'consent-sms-contact', 'Visa SMS wording still routes here');
assert(pick(MS.q10).topic !== 'consent-future-opportunities', 'Q10 not stolen by the consent-future-opportunities (Yes) topic');

console.log('\n--- (F) securities registration collisions ---');
assert(pick(MS.q4).topic === 'securities-registration', 'Q4 -> securities-registration');
assert(pick('Do you have the unrestricted right to work in the country?').topic === 'unrestricted-right-to-work', 'unrestricted-right-to-work unaffected');
assert(pick('Are you legally authorized to work in the United States?').topic === 'work-authorization', 'plain work-auth unaffected by Q1 wording');

console.log('\n=== Race/ethnicity precedence (Chinese > East Asian > Asian > Asian-Not Listed) ===');
const race = BANK.find(e => e.topic === 'race-ethnicity');
// Replays selectEntryOption: each candidate is a full pass over the option list, in order.
const pickRace = options => {
  for (const cand of race.optionCandidates) {
    const hit = options.find(o => cand.test(o));
    if (hit) return hit;
  }
  return null;
};
const VISA_RACE = [
  'Select One',
  'Asian – Chinese (Not Latinx or Hispanic) (United States of America)',
  'Asian – Asian Indian (Not Latinx or Hispanic) (United States of America)',
  'Asian – Not Listed (Not Latinx or Hispanic) (United States of America)',
  'White (Not Latinx or Hispanic) (United States of America)',
  'Black or African American (Not Latinx or Hispanic) (United States of America)'
];
const FLAT_RACE = ['Select One', 'Asian (United States of America)', 'White (United States of America)', 'Two or More Races (United States of America)'];
const NOT_LISTED_ONLY = ['Select One', 'Asian – Not Listed (Not Latinx or Hispanic)', 'White'];
const TAIPEI_TRAP = ['Select One', 'Chinese Taipei', 'Asian (United States of America)'];
assert(pickRace(VISA_RACE) === 'Asian – Chinese (Not Latinx or Hispanic) (United States of America)', 'Visa granular list -> prefers the Chinese subgroup (not "Not Listed")');
assert(pickRace(FLAT_RACE) === 'Asian (United States of America)', 'flat list (BlackRock/Citi/GHR/Hitachi) -> still resolves plain Asian');
assert(pickRace(NOT_LISTED_ONLY) === 'Asian – Not Listed (Not Latinx or Hispanic)', 'Not-Listed used as last resort when it is the only Asian option');
assert(pickRace(TAIPEI_TRAP) === 'Asian (United States of America)', 'never picks "Chinese Taipei"');
assert(!race.optionCandidates.some(c => c.test('White (Not Latinx or Hispanic) (United States of America)')), 'no candidate matches a White option via the Latinx qualifier');
assert(!race.optionCandidates.some(c => c.test('Black or African American (Not Latinx or Hispanic)')), 'no candidate matches a Black option via the Latinx qualifier');
routes('Please select the appropriate Race/Ethnicity with which you identify', 'race-ethnicity');
assert(pick('What is your primary nationality?')?.topic !== 'race-ethnicity', 'race entry does not capture a nationality picker');
assert(pick('Are you Hispanic or Latino?')?.topic === 'hispanic-latino', 'hispanic-latino behaviour intact');

console.log('\n=== AVEVA Voluntary Disclosures shapes ===');
const AVEVA_RACE = 'Please Select All That Apply* American Indian or Alaska Native (Not Hispanic or Latino) (United States of America) Asian (Not Hispanic or Latino) (United States of America) Black or African American (Not Hispanic or Latino) (United States of America) Hispanic or Latino (United States of America) Native Hawaiian or Other Pacific Islander (Not Hispanic or Latino) (United States of America) Two or More Races (Not Hispanic or Latino) (United States of America) White (Not Hispanic or Latino) (United States of America)';
const AVEVA_VEVRAA = 'As a Government contractor subject to VEVRAA, we are required to submit a report to the United States Department of Labor each year identifying the number of our employees belonging to each specified "protected veteran" category. If you believe you belong to any of the categories of protected veterans listed below, please indicate by checking the appropriate box below. If you are a disabled veteran it would assist us if you tell us whether there are accommodations we could make that would enable you to perform the essential functions of the job, including special equipment, changes in the physical layout of the job';
routes(AVEVA_RACE, 'race-ethnicity');
routes(AVEVA_VEVRAA, 'veteran');
routes('Hispanic or Latino', 'hispanic-latino');
assert(pick(AVEVA_RACE).topic !== 'hispanic-latino', 'race checkbox group not stolen by hispanic-latino (its labels are full of "Hispanic or Latino")');
assert(pick(AVEVA_VEVRAA).topic !== 'essential-functions', 'VEVRAA block not stolen by essential-functions (its text says "essential functions of the job")');
// The legitimate ADA essential-functions question must still route to essential-functions.
routes('Are you able to perform the essential functions of the job for which you are applying with or without reasonable accommodation?', 'essential-functions');
// AVEVA's veteran option list: the anchored matcher must take the NOT-a-protected-veteran option
// and none of the category/trap options.
const AVEVA_VET_OPTS = ['Select One','Disabled Veteran','Recently Separated Veteran','Active Wartime or Campaign Badge Veteran','Armed Forces Service Medal Veteran','I am a protected veteran, but I choose not to self-identify the classifications to which I belong.','I am NOT a protected veteran.','I prefer not to answer.'];
const vet = BANK.find(e => e.topic === 'veteran');
const vetHits = AVEVA_VET_OPTS.filter(o => vet.optionMatch.test(o));
assert(vetHits.length === 1 && vetHits[0] === 'I am NOT a protected veteran.', `veteran matcher selects exactly "I am NOT a protected veteran." (hits: ${JSON.stringify(vetHits)})`);
// AVEVA's race labels: precedence must land on plain Asian (no Chinese/East Asian option offered).
const AVEVA_RACE_LABELS = ['American Indian or Alaska Native (Not Hispanic or Latino) (United States of America)','Asian (Not Hispanic or Latino) (United States of America)','Black or African American (Not Hispanic or Latino) (United States of America)','Hispanic or Latino (United States of America)','Native Hawaiian or Other Pacific Islander (Not Hispanic or Latino) (United States of America)','Two or More Races (Not Hispanic or Latino) (United States of America)','White (Not Hispanic or Latino) (United States of America)'];
const raceEntry = BANK.find(e => e.topic === 'race-ethnicity');
const pickRaceLabel = opts => { for (const cand of raceEntry.optionCandidates) { const hit = opts.find(o => cand.test(o)); if (hit) return hit; } return null; };
assert(pickRaceLabel(AVEVA_RACE_LABELS) === 'Asian (Not Hispanic or Latino) (United States of America)', 'AVEVA race checkboxes -> Asian (no Chinese/East Asian offered)');

console.log('\n=== Shared Ashby screenshot topics mirrored into Workday (2026-07-27) ===');
const ALL_LOCATIONS = 'Please indicate all of the locations that you would be interested in relocating to for this position.';
routes(ALL_LOCATIONS, 'relocation-locations-all');
assert(pick(ALL_LOCATIONS).checkAll === true, 'every offered relocation location is ticked, not just one');
routes('Do you have experience with LLMs?', 'llm-experience');
routes('Please describe your AI experience.', 'ai-experience-essay');
const VISA_TYPE_SPONSORSHIP = 'Will you now or at any time in the future require sponsorship for employment visa status (e.g. H1B, OPT)?';
routes(VISA_TYPE_SPONSORSHIP, 'sponsorship');
const VISA_OPTIONS = ['OPT', 'H1B', 'TN', 'None', 'Other'];
const visaPick = (() => { for (const c of pick(VISA_TYPE_SPONSORSHIP).optionCandidates) { const i = VISA_OPTIONS.findIndex(t => c.test(t)); if (i >= 0) return i; } return -1; })();
assert(VISA_OPTIONS[visaPick] === 'H1B', `visa-type sponsorship list picks H1B (got ${VISA_OPTIONS[visaPick]})`);
const YES_NO_SPONSOR = ['Yes', 'No'];
const yesNoPick = (() => { for (const c of pick(VISA_TYPE_SPONSORSHIP).optionCandidates) { const i = YES_NO_SPONSOR.findIndex(t => c.test(t)); if (i >= 0) return i; } return -1; })();
assert(YES_NO_SPONSOR[yesNoPick] === 'Yes', 'a plain Yes/No sponsorship control still answers Yes');

console.log('\n=== Why-this-role essay (shared bank, user wording 2026-07-27) ===');
const INTERESTED_ROLE = 'What interested you about this role?';
routes(INTERESTED_ROLE, 'why-company-essay');
// "Why do you want to work here?" stays with the older, more specific ideal-candidate pitch on
// this engine — both are appropriate essays; only the "what interested you" shape is new.
routes('Why do you want to work here?', 'ideal-candidate-pitch');
routes('What interests you about this position?', 'why-company-essay');
assert(/^I am interested in your company because I thrive in new environments/.test(pick(INTERESTED_ROLE).text), 'why-company essay uses the user-supplied wording');

console.log('\n=== Location questions (shared bank, screenshots 2026-07-27) ===');
const HUB_COMMUTE = 'Do you live within commuting distance to one of our hubs (NY, SF, DC, BOS or London)?';
routes(HUB_COMMUTE, 'office-attendance-requirement');
assert(pick(HUB_COMMUTE).choose === 'yes', 'commuting distance to a hub -> Yes');
const CITY_STATE_RESIDENCE = 'What is your current city and state of residence?';
routes(CITY_STATE_RESIDENCE, 'current-location-text');
assert(pick(CITY_STATE_RESIDENCE).text === 'Dallas, TX', 'current city and state of residence -> Dallas, TX');
routes('Where are you currently located?', 'current-location-text');
routes('Where do you currently live?', 'current-location-text');
routes('Are you currently located in North America?', 'current-location-north-america');

console.log('\n=== Structure ===');
const topics = APP.map(e => e.topic);
const dupes = topics.filter((t, i) => topics.indexOf(t) !== i);
assert(dupes.length === 0, `no duplicate topics (${topics.length} application topics)${dupes.length ? ' dupes=' + dupes : ''}`);
assert(src.includes("name: 'English'") && src.includes("level: 'C2 (Proficient/Native Speaker)'"), 'My Experience language defaults are English and C2');
assert(src.includes("name: 'Chinese (Mandarin)'"), 'My Experience language defaults include Chinese (Mandarin)');
assert((src.match(/native: true/g) || []).length >= 2, 'native is ticked on BOTH default languages');
assert(src.includes('async function fillRequiredLanguages('), 'My Experience has a required-language handler');
assert(src.includes('if (!required) return { ok: true, filled: false };'), 'optional Languages sections remain untouched');
// indexOf(-1) would make an ordering assert pass vacuously — require the call to exist first.
const languageCall = src.indexOf('await fillRequiredLanguages(data.languages, data.levelCandidates, context)');
assert(languageCall >= 0 && languageCall < src.indexOf('// Skills section is intentionally skipped'), 'required languages fill before My Experience advances');
routes('Are you subject to any restrictive covenant or non-competition agreement that may affect your ability to work for Relativity?', 'restrictive-agreements');
assert(pick('Are you subject to any restrictive covenant or non-competition agreement that may affect your ability to work for Relativity?').choose === 'no', 'Relativity restrictive covenant -> No');
// Relativity renders this as a required FREE-TEXT box, not a dropdown, so the entry carries BOTH a
// Yes/No choice and a text answer; the runtime uses whichever control the tenant actually shows.
assert(pick('Are you subject to any restrictive covenant or non-competition agreement that may affect your ability to work for Relativity?').text === 'No.', 'restrictive covenant free-text answer -> "No."');
assert(src.includes('hasChoice: Boolean(entry.optionMatch || entry.choose)')
  && src.includes('(entry.textAnswer && !entry.hasChoice)'),
  'a text+choice entry falls back to its Yes/No answer when the block has no text control');
routes('Do you have a non-compete or non-solicit agreement with a current or former employer?', 'restrictive-agreements');
routes('Are you subject to any agreement that would restrict you from working for us?', 'restrictive-agreements');
routes('What is your desired start date?', 'desired-start-date');
assert(pick('What is your desired start date?').text === '09/07/2026', 'desired start date -> 09/07/2026');
routes('Have you in the past or are you currently interviewing for any positions with Insperity?', 'prior-current-interview');
assert(pick('Have you in the past or are you currently interviewing for any positions with Insperity?').choose === 'no', 'prior/current employer interview -> No');

// User-supplied Q&A (2026-07-27): "willing to move to <city>" / "work in person with us" phrasing
// is the same standing relocation rule as "willing to relocate", just worded with "move" instead.
const SF_MOVE_IN_PERSON = 'Are you willing to move to SF and work in person with us?';
routes(SF_MOVE_IN_PERSON, 'relocation-consider');
assert(pick(SF_MOVE_IN_PERSON).choose === 'yes', 'willing to move + work in person -> Yes');

console.log('\n=== User-supplied Q&A batch (2026-07-27): SF Bay Area, sponsorship, relocation, Column consent, self-ID, Robinhood COI ===');
// Replicates chooserPicker/selectEntryOption: optionCandidates = ORDERED precedence, each a full
// pass; falls back to optionMatch, then a plain choose:'yes'/'no' predicate.
const optPick = (topic, options) => {
  const e = BANK.find(x => x.topic === topic);
  if (!e) return '(no entry)';
  if (e.optionCandidates) {
    for (const cand of e.optionCandidates) {
      const hit = options.find(t => cand.test(t));
      if (hit) return hit;
    }
    return '(none)';
  }
  const pred = e.optionMatch ? (t => e.optionMatch.test(t))
    : e.choose === 'yes' ? (t => /^yes\b/i.test(t))
    : e.choose === 'no' ? (t => /^no\b/i.test(t)) : null;
  if (!pred) return '(no pred)';
  return options.find(pred) ?? '(none)';
};

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
routes(PRESIDIO_IN_PERSON_Q, 'relocation-consider');
assert(pick(PRESIDIO_IN_PERSON_Q).choose === 'yes', 'able to work in-person in SF -> Yes');
const REQUIRE_RELOCATION_Q = 'Will you require relocation?';
routes(REQUIRE_RELOCATION_Q, 'relocation-consider');
assert(pick(REQUIRE_RELOCATION_Q).choose === 'yes', 'will you require relocation -> Yes');

const COLUMN_CONSENT_Q = 'Do you agree to allow Column to contact you about job opportunities for up to 2 years? (Recruiting Privacy Policy)';
routes(COLUMN_CONSENT_Q, 'consent-future-opportunities');
assert(optPick('consent-future-opportunities', ['I agree', 'I do not agree']) === 'I agree', 'Column recruiting-contact consent picks I agree, never decline');
assert(optPick('consent-future-opportunities', ['Yes', 'No']) === 'Yes', 'a plain Yes/No consent control still answers Yes');

const GENDER_IDENTITY_Q = 'What is your gender identity?';
routes(GENDER_IDENTITY_Q, 'gender-identity');
assert(optPick('gender-identity', ['Cisgender man', 'Cisgender woman', 'Non-binary', 'Prefer not to say']) === 'Cisgender man', 'gender identity picks Cisgender man when offered');
assert(optPick('gender-identity', ['Man', 'Woman', 'Non-binary']) === 'Man', 'gender identity falls back to plain Man');

const RACE_Q = 'What is your race or ethnicity?';
routes(RACE_Q, 'race-ethnicity');
assert(optPick('race-ethnicity', ['White', 'Black or African American', 'East Asian', 'South Asian', 'Decline to answer']) === 'East Asian', 'race/ethnicity picks East Asian when offered (already matched before this change)');

const MIL_STATUS_Q = 'What is your military status?';
routes(MIL_STATUS_Q, 'veteran');
assert(optPick('veteran', ['I have never served in the military', 'I am a veteran', 'I decline to answer']) === 'I have never served in the military', 'military status picks "never served" when offered (already routed correctly before this change)');
assert(optPick('veteran', ['I am not a protected veteran', 'I identify as one or more of the classifications of a protected veteran']) === 'I am not a protected veteran', 'military status falls back to not-a-veteran wording');

const DISABILITY_STATUS_Q = 'What is your disability status?';
routes(DISABILITY_STATUS_Q, 'disability-selfid');
assert(optPick('disability-selfid', ["No, I don't have a disability", 'Yes, I have a disability', "I don't wish to answer"]) === "No, I don't have a disability", 'disability status picks the exact no-disability wording, never decline');
assert(optPick('disability-selfid', ['No', 'Yes']) === 'No', 'disability status falls back to plain No');

const LGBTQ_Q = 'Do you identify as part of the LGBTQ+ community?';
routes(LGBTQ_Q, 'lgbtq-identity');
assert(optPick('lgbtq-identity', ['Yes', 'No']) === 'No', 'LGBTQ+ Yes/No control picks No');

const ROBINHOOD_COI_Q = "Do you have: a) any Personal/Familial Relationships (current Robinhood employees or employees of Robinhood's vendors); b) any Outside Business Activities that you wish to continue; c) any investment that is greater than 5% of the outstanding shares of a publicly-traded company; d) any investment in a private company that has a business relationship or that is a current competitor of Robinhood; or e) any Intellectual Property Ownership (patents, trademarks, copyrights) that you wish to retain and/or create/develop while at Robinhood?";
routes(ROBINHOOD_COI_Q, 'conflict-of-interest');
assert(pick(ROBINHOOD_COI_Q).choose === 'no', 'Robinhood omnibus conflict-of-interest disclosure -> No');

console.log('\n=== User-supplied Q&A batch 2 (2026-07-27): SMS long-form, level, US Person, hybrid role, startup, built essay, employment, Harvey office/relocation chain ===');
// Pair 1: SMS consent already routed correctly before this round — regression-guard the long-form
// option pick.
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
assert(pick('Are you legally authorized to work in the United States?')?.choose === 'yes', 'work-authorization is untouched by us-person-status and stays Yes');
assert(pick('Do you have the unrestricted right to work in the United States?')?.topic === 'unrestricted-right-to-work' && pick('Do you have the unrestricted right to work in the United States?').choose === 'yes', 'unrestricted-right-to-work is untouched by us-person-status and stays Yes');

// Pair 4: hybrid ROLE (no "office" word) with a weekly cadence -> Yes, via relocation-consider.
const HYBRID_ROLE_Q = 'This hybrid role involves being in San Carlos, CA, 3 days per week. Please mark Yes that you read, understand, and are able to do this.';
routes(HYBRID_ROLE_Q, 'relocation-consider');
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

console.log(`\nTOTAL ${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILURES` : ''}`);
process.exit(fail ? 1 : 0);
