const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");
const logger = require('@src/logger');

/**
 * Enhanced Gemini Client Service
 * Wraps @google/generative-ai SDK with Lemo-specific functionality
 */
class GeminiClient {
  /**
   * @param {string} apiKey - Gemini API key
   * @param {string} model - Model name (default: gemini-2.0-flash-exp)
   */
  constructor(apiKey, model = 'gemini-2.0-flash-exp') {
    if (!apiKey) {
      throw new Error('Gemini API key is required');
    }

    this.apiKey = apiKey;
    this.model = model;
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.fileManager = new GoogleAIFileManager(apiKey);

    // Default safety settings - disable all blocks for developer use case
    this.safetySettings = [
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
    ];
  }

  /**
   * Generate content with streaming
   * @param {string} prompt - User prompt
   * @param {object} options - Generation options
   * @param {function} onChunk - Callback for each token chunk
   * @returns {Promise<string>} Complete generated content
   */
  async generateContentStream(prompt, options = {}, onChunk = null) {
    const {
      systemInstruction = null,
      temperature = 0.7,
      maxOutputTokens = 8192,
      fileUris = [],
      tools = null,
      enableThinking = false,
      enableGrounding = false,
      codeExecution = true,
      messages = [],
    } = options;

    // Build generation config
    const generationConfig = {
      temperature,
      maxOutputTokens,
      topP: 0.95,
      topK: 40,
    };

    // Enable code execution if requested
    if (codeExecution) {
      generationConfig.codeExecution = { enable: true };
    }

    // Enable Google Search grounding if requested
    if (enableGrounding) {
      generationConfig.googleSearchRetrieval = {
        dynamicRetrievalConfig: {
          mode: "MODE_DYNAMIC",
          dynamicThreshold: 0.7,
        },
      };
    }

    // Build model config
    const modelConfig = {
      model: this.model,
      generationConfig,
      safetySettings: this.safetySettings,
    };

    // Add system instruction if provided
    if (systemInstruction) {
      modelConfig.systemInstruction = systemInstruction;
    }

    // Add tools (function calling) if provided
    if (tools && tools.length > 0) {
      modelConfig.tools = [{ functionDeclarations: tools }];
    }

    // Get model instance
    const model = this.genAI.getGenerativeModel(modelConfig);

    // Build content parts
    const parts = [{ text: prompt }];

    // Add file references to content
    if (fileUris && fileUris.length > 0) {
      for (const uri of fileUris) {
        parts.push({
          fileData: {
            mimeType: "auto", // Let Gemini detect MIME type
            fileUri: uri,
          },
        });
      }
    }

    try {
      // Start streaming
      const result = await model.generateContentStream({
        contents: [{ role: "user", parts }],
      });

      let fullText = '';

      // Stream chunks
      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        fullText += chunkText;

        if (onChunk && chunkText) {
          onChunk(chunkText);
        }
      }

      logger.info('[GeminiClient] Content generation completed', {
        promptLength: prompt.length,
        responseLength: fullText.length,
        fileCount: fileUris.length,
      });

      return fullText;
    } catch (error) {
      logger.error('[GeminiClient] Generation error', {
        error: error.message,
        model: this.model,
      });
      throw error;
    }
  }

  /**
   * Generate content without streaming
   * @param {string} prompt - User prompt
   * @param {object} options - Generation options
   * @returns {Promise<string>} Generated content
   */
  async generateContent(prompt, options = {}) {
    return this.generateContentStream(prompt, options, null);
  }

  /**
   * Upload file to Gemini File API
   * @param {Buffer} buffer - File content as buffer
   * @param {string} mimeType - File MIME type
   * @param {string} displayName - Display name for the file
   * @returns {Promise<object>} File metadata { uri, name, mimeType, sizeBytes }
   */
  async uploadFile(buffer, mimeType, displayName) {
    try {
      // Create temporary file path
      const tempFilePath = `/tmp/gemini_upload_${Date.now()}_${displayName}`;
      const fs = require('fs');
      fs.writeFileSync(tempFilePath, buffer);

      // Upload to Gemini
      const uploadResult = await this.fileManager.uploadFile(tempFilePath, {
        mimeType,
        displayName,
      });

      // Clean up temp file
      fs.unlinkSync(tempFilePath);

      logger.info('[GeminiClient] File uploaded successfully', {
        uri: uploadResult.file.uri,
        name: uploadResult.file.name,
        size: uploadResult.file.sizeBytes,
      });

      return {
        uri: uploadResult.file.uri,
        name: uploadResult.file.name,
        mimeType: uploadResult.file.mimeType,
        sizeBytes: uploadResult.file.sizeBytes,
      };
    } catch (error) {
      logger.error('[GeminiClient] File upload error', {
        error: error.message,
        displayName,
        mimeType,
      });
      throw error;
    }
  }

  /**
   * Delete file from Gemini File API
   * @param {string} fileUri - Gemini file URI (e.g., "files/abc123")
   * @returns {Promise<boolean>} Success status
   */
  async deleteFile(fileUri) {
    try {
      // Extract file name from URI
      const fileName = fileUri.replace('https://generativelanguage.googleapis.com/v1beta/', '');

      await this.fileManager.deleteFile(fileName);

      logger.info('[GeminiClient] File deleted successfully', { uri: fileUri });
      return true;
    } catch (error) {
      // Handle 404 gracefully (file already deleted or expired)
      if (error.message && error.message.includes('404')) {
        logger.warn('[GeminiClient] File not found (already deleted or expired)', {
          uri: fileUri,
        });
        return true;
      }

      logger.error('[GeminiClient] File deletion error', {
        error: error.message,
        uri: fileUri,
      });
      throw error;
    }
  }

  /**
   * Get file metadata from Gemini API
   * @param {string} fileUri - Gemini file URI
   * @returns {Promise<object>} File metadata
   */
  async getFile(fileUri) {
    try {
      const fileName = fileUri.replace('https://generativelanguage.googleapis.com/v1beta/', '');
      const file = await this.fileManager.getFile(fileName);

      return {
        uri: file.uri,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        createTime: file.createTime,
        expirationTime: file.expirationTime,
      };
    } catch (error) {
      logger.error('[GeminiClient] Get file error', {
        error: error.message,
        uri: fileUri,
      });
      throw error;
    }
  }

  /**
   * Build function declarations for Gemini function calling
   * @param {object} tools - Lemo tools object
   * @returns {array} Array of function declarations
   */
  buildFunctionDeclarations(tools) {
    const declarations = [];

    for (const [toolName, tool] of Object.entries(tools)) {
      const declaration = {
        name: toolName,
        description: tool.description || '',
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      };

      // Convert Lemo tool params to Gemini function parameters
      if (tool.params && typeof tool.params === 'object') {
        for (const [paramName, paramDef] of Object.entries(tool.params)) {
          declaration.parameters.properties[paramName] = {
            type: paramDef.type || "string",
            description: paramDef.description || '',
          };

          if (paramDef.required) {
            declaration.parameters.required.push(paramName);
          }
        }
      }

      declarations.push(declaration);
    }

    logger.info('[GeminiClient] Built function declarations', {
      count: declarations.length,
      tools: Object.keys(tools),
    });

    return declarations;
  }

  /**
   * Parse function calls from Gemini response
   * @param {object} response - Gemini API response
   * @returns {array} Array of actions { type, params }
   */
  parseFunctionCalls(response) {
    const actions = [];

    if (!response || !response.functionCalls) {
      return actions;
    }

    for (const call of response.functionCalls) {
      actions.push({
        type: call.name,
        params: call.args || {},
      });
    }

    logger.info('[GeminiClient] Parsed function calls', {
      count: actions.length,
      actions: actions.map(a => a.type),
    });

    return actions;
  }
}

module.exports = GeminiClient;
