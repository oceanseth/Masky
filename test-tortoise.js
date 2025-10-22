#!/usr/bin/env node

/**
 * Tortoise TTS Connection Tester
 * Standalone script to test API connectivity and endpoints
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

class TortoiseTester {
    constructor() {
        this.baseUrl = 'http://127.0.0.1:7860';
        this.results = {
            baseUrl: this.baseUrl,
            timestamp: new Date().toISOString(),
            tests: []
        };
    }

    async makeRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const client = urlObj.protocol === 'https:' ? https : http;
            
            const requestOptions = {
                hostname: urlObj.hostname,
                port: urlObj.port,
                path: urlObj.pathname + urlObj.search,
                method: options.method || 'GET',
                headers: options.headers || {},
                timeout: 5000
            };

            const req = client.request(requestOptions, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    resolve({
                        statusCode: res.statusCode,
                        statusMessage: res.statusMessage,
                        headers: res.headers,
                        data: data,
                        contentType: res.headers['content-type']
                    });
                });
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            if (options.body) {
                req.write(options.body);
            }

            req.end();
        });
    }

    async testBasicConnectivity() {
        console.log('\n🔍 Testing Basic Connectivity...');
        console.log('='.repeat(50));
        
        const test = {
            name: 'Basic Connectivity',
            url: this.baseUrl,
            method: 'GET',
            status: 'failed',
            details: {}
        };

        try {
            const response = await this.makeRequest(this.baseUrl);
            
            test.status = 'success';
            test.details = {
                statusCode: response.statusCode,
                statusMessage: response.statusMessage,
                contentType: response.contentType,
                responseLength: response.data.length,
                containsGradio: response.data.includes('gradio') || response.data.includes('Gradio'),
                containsTortoise: response.data.toLowerCase().includes('tortoise')
            };
            
            console.log(`✅ Base URL accessible: ${response.statusCode} ${response.statusMessage}`);
            console.log(`📄 Response length: ${response.data.length} bytes`);
            console.log(`🎯 Contains Gradio: ${test.details.containsGradio}`);
            console.log(`🐢 Contains Tortoise: ${test.details.containsTortoise}`);
            
            if (response.statusCode === 200) {
                console.log(`📋 Content-Type: ${response.contentType}`);
            }
            
        } catch (error) {
            test.status = 'error';
            test.details.error = error.message;
            console.log(`❌ Base URL failed: ${error.message}`);
            
            if (error.code === 'ECONNREFUSED') {
                console.log('💡 Suggestion: Server may not be running on port 7860');
            }
        }
        
        this.results.tests.push(test);
    }

    async testCommonEndpoints() {
        console.log('\n🔍 Testing Common Endpoints...');
        console.log('='.repeat(50));
        
        const endpoints = [
            '/',
            '/api',
            '/docs',
            '/config',
            '/api/predict',
            '/run/predict',
            '/predict',
            '/api/predict/0',
            '/api/predict/1',
            '/upload',
            '/file',
            '/health',
            '/status',
            '/info'
        ];

        const workingEndpoints = [];
        const notFoundEndpoints = [];
        const errorEndpoints = [];

        for (const endpoint of endpoints) {
            const test = {
                name: `Endpoint: ${endpoint}`,
                url: `${this.baseUrl}${endpoint}`,
                method: 'GET',
                status: 'failed',
                details: {}
            };

            try {
                const response = await this.makeRequest(`${this.baseUrl}${endpoint}`);
                
                test.details.statusCode = response.statusCode;
                test.details.statusMessage = response.statusMessage;
                test.details.contentType = response.contentType;
                
                if (response.statusCode === 200) {
                    test.status = 'success';
                    workingEndpoints.push(endpoint);
                    console.log(`✅ ${endpoint}: ${response.statusCode}`);
                } else if (response.statusCode === 404) {
                    test.status = 'not_found';
                    notFoundEndpoints.push(endpoint);
                } else {
                    test.status = 'error';
                    errorEndpoints.push(endpoint);
                    console.log(`⚠️  ${endpoint}: ${response.statusCode} ${response.statusMessage}`);
                }
                
            } catch (error) {
                test.status = 'error';
                test.details.error = error.message;
                errorEndpoints.push(endpoint);
            }
            
            this.results.tests.push(test);
            
            // Small delay to avoid overwhelming server
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        console.log(`\n📊 Results: ${workingEndpoints.length} working, ${notFoundEndpoints.length} not found, ${errorEndpoints.length} errors`);
        
        if (workingEndpoints.length > 0) {
            console.log('\n✅ Working endpoints:');
            workingEndpoints.forEach(ep => console.log(`   ${ep}`));
        }
    }

    async testGradioAPI() {
        console.log('\n🔍 Testing Gradio API Endpoints...');
        console.log('='.repeat(50));
        
        const gradioTests = [
            {
                endpoint: '/api/predict',
                data: { data: ["test"] }
            },
            {
                endpoint: '/run/predict',
                data: { data: ["test"] }
            },
            {
                endpoint: '/api/predict/0',
                data: { data: ["test"] }
            },
            {
                endpoint: '/api/predict/1',
                data: { data: ["test"] }
            }
        ];

        const workingApis = [];

        for (const gradioTest of gradioTests) {
            const test = {
                name: `Gradio POST: ${gradioTest.endpoint}`,
                url: `${this.baseUrl}${gradioTest.endpoint}`,
                method: 'POST',
                status: 'failed',
                details: {}
            };

            try {
                const response = await this.makeRequest(`${this.baseUrl}${gradioTest.endpoint}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(gradioTest.data)
                });
                
                test.details.statusCode = response.statusCode;
                test.details.statusMessage = response.statusMessage;
                
                if (response.statusCode >= 200 && response.statusCode < 300) {
                    test.status = 'success';
                    workingApis.push(gradioTest.endpoint);
                    console.log(`✅ Gradio ${gradioTest.endpoint}: ${response.statusCode}`);
                    
                    try {
                        const responseData = JSON.parse(response.data);
                        test.details.response = responseData;
                        console.log(`   Response: ${JSON.stringify(responseData).substring(0, 100)}...`);
                    } catch (e) {
                        console.log(`   Response: ${response.data.substring(0, 100)}...`);
                    }
                } else if (response.statusCode === 422) {
                    console.log(`⚠️  Gradio ${gradioTest.endpoint}: 422 (Expected - wrong parameters)`);
                    test.status = 'wrong_params';
                    workingApis.push(gradioTest.endpoint); // Still a valid endpoint
                } else {
                    test.status = 'error';
                    console.log(`❌ Gradio ${gradioTest.endpoint}: ${response.statusCode}`);
                }
                
            } catch (error) {
                test.status = 'error';
                test.details.error = error.message;
                console.log(`💥 Gradio ${gradioTest.endpoint}: ${error.message}`);
            }
            
            this.results.tests.push(test);
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        if (workingApis.length > 0) {
            console.log('\n🎯 Potential API endpoints found:');
            workingApis.forEach(api => console.log(`   ${api}`));
        }
    }

    async testServerInfo() {
        console.log('\n🔍 Gathering Server Information...');
        console.log('='.repeat(50));
        
        const infoEndpoints = ['/config', '/api', '/docs', '/info', '/swagger.json'];
        
        for (const endpoint of infoEndpoints) {
            try {
                const response = await this.makeRequest(`${this.baseUrl}${endpoint}`);
                if (response.statusCode === 200) {
                    console.log(`📋 Server info from ${endpoint}:`);
                    
                    try {
                        const data = JSON.parse(response.data);
                        console.log(JSON.stringify(data, null, 2).substring(0, 500) + '...');
                        
                        this.results.serverInfo = this.results.serverInfo || {};
                        this.results.serverInfo[endpoint] = data;
                    } catch (e) {
                        console.log(response.data.substring(0, 200) + '...');
                    }
                }
            } catch (error) {
                // Silently continue
            }
        }
    }

    displaySummary() {
        console.log('\n' + '='.repeat(60));
        console.log('📋 TEST SUMMARY');
        console.log('='.repeat(60));
        
        console.log(`🌐 Base URL: ${this.results.baseUrl}`);
        console.log(`⏰ Test Time: ${this.results.timestamp}`);
        
        const successCount = this.results.tests.filter(t => t.status === 'success').length;
        const totalCount = this.results.tests.length;
        
        console.log(`📊 Success Rate: ${successCount}/${totalCount} (${Math.round(successCount/totalCount*100)}%)`);
        
        // Show working endpoints
        const workingEndpoints = this.results.tests.filter(t => t.status === 'success');
        if (workingEndpoints.length > 0) {
            console.log('\n✅ Working Endpoints:');
            workingEndpoints.forEach(test => {
                console.log(`   ${test.url.replace(this.baseUrl, '')} (${test.details.statusCode})`);
            });
        }
        
        // Show potential API endpoints
        const apiEndpoints = this.results.tests.filter(t => 
            (t.status === 'success' || t.status === 'wrong_params') && 
            (t.url.includes('/api') || t.url.includes('/predict'))
        );
        
        if (apiEndpoints.length > 0) {
            console.log('\n🎯 Potential API Endpoints:');
            apiEndpoints.forEach(test => {
                const endpoint = test.url.replace(this.baseUrl, '');
                console.log(`   ${endpoint} (${test.details.statusCode})`);
            });
        }
        
        // Recommendations
        console.log('\n💡 Recommendations:');
        if (this.results.tests.some(t => t.details.containsGradio)) {
            console.log('   ✓ This appears to be a Gradio app');
        }
        if (this.results.tests.some(t => t.details.containsTortoise)) {
            console.log('   ✓ This appears to be Tortoise TTS');
        }
        if (workingEndpoints.some(t => t.url.includes('/config'))) {
            console.log('   ✓ Check /config endpoint for API structure');
        }
        if (apiEndpoints.length > 0) {
            console.log(`   ✓ Found ${apiEndpoints.length} potential API endpoints`);
            console.log('   ✓ Try these endpoints in your voice cloner');
        }
        if (workingEndpoints.length === 0) {
            console.log('   ❌ Server may not be running on port 7860');
            console.log('   ❌ Check if Tortoise TTS is accessible in browser');
            console.log('   ❌ Verify server is started and listening');
        }
        
        console.log('\n🔧 Next Steps:');
        if (apiEndpoints.length > 0) {
            console.log('   1. Copy the working API endpoints above');
            console.log('   2. Update your voice cloner to use these endpoints');
            console.log('   3. Test voice cloning with discovered endpoints');
        } else {
            console.log('   1. Verify Tortoise TTS server is running:');
            console.log(`      curl ${this.baseUrl}`);
            console.log('   2. Check server logs for errors');
            console.log('   3. Try accessing the web interface in browser');
        }
        
        console.log('='.repeat(60));
    }

    async runAllTests() {
        console.log('🚀 Starting Tortoise TTS Connection Tests...');
        console.log(`🎯 Target: ${this.baseUrl}`);
        
        await this.testBasicConnectivity();
        await this.testCommonEndpoints();
        await this.testGradioAPI();
        await this.testServerInfo();
        
        this.displaySummary();
        
        // Save results to file
        const fs = require('fs');
        const resultsFile = 'tortoise-test-results.json';
        fs.writeFileSync(resultsFile, JSON.stringify(this.results, null, 2));
        console.log(`\n💾 Full results saved to: ${resultsFile}`);
    }
}

// Run the tests
if (require.main === module) {
    const tester = new TortoiseTester();
    tester.runAllTests().catch(error => {
        console.error('❌ Test runner failed:', error.message);
        process.exit(1);
    });
}

module.exports = TortoiseTester;