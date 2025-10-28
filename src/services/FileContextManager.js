const FileContext = require('@src/models/FileContext');
const GeminiClient = require('./GeminiClient');
const logger = require('@src/logger');

/**
 * FileContextManager Service
 * Central service for managing file context lifecycle using Gemini File API
 */
class FileContextManager {
  constructor() {
    // Initialize Gemini client with API key from environment
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      logger.warn('[FileContextManager] GEMINI_API_KEY not set, file operations will fail');
    }
    this.geminiClient = apiKey ? new GeminiClient(apiKey) : null;
  }

  /**
   * Upload file to Gemini File API and create database record
   * @param {string} conversation_id - Conversation ID
   * @param {Buffer} file_buffer - File content as buffer
   * @param {string} filename - User-friendly filename
   * @param {string} mime_type - File MIME type
   * @param {string} description - Optional file description
   * @returns {Promise<object>} File metadata
   */
  async uploadFile(conversation_id, file_buffer, filename, mime_type, description = null) {
    if (!this.geminiClient) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    try {
      // Check if file already exists
      const existing = await FileContext.findByFilename(conversation_id, filename);
      if (existing) {
        throw new Error(`File '${filename}' already exists in conversation. Use updateFile instead.`);
      }

      // Upload to Gemini File API
      logger.info('[FileContextManager] Uploading file to Gemini', {
        conversation_id,
        filename,
        mime_type,
        size: file_buffer.length,
      });

      const uploadResult = await this.geminiClient.uploadFile(
        file_buffer,
        mime_type,
        filename
      );

      // Create database record
      const fileRecord = await FileContext.create({
        conversation_id,
        filename,
        gemini_file_uri: uploadResult.uri,
        gemini_file_name: uploadResult.name,
        mime_type: uploadResult.mimeType,
        size_bytes: uploadResult.sizeBytes,
        display_name: filename,
        description,
      });

      logger.info('[FileContextManager] File uploaded successfully', {
        conversation_id,
        filename,
        uri: uploadResult.uri,
      });

      return {
        id: fileRecord.id,
        filename: fileRecord.filename,
        gemini_file_uri: fileRecord.gemini_file_uri,
        mime_type: fileRecord.mime_type,
        size_bytes: fileRecord.size_bytes,
        created_at: fileRecord.created_at,
      };
    } catch (error) {
      logger.error('[FileContextManager] File upload failed', {
        conversation_id,
        filename,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get file metadata from database
   * @param {string} conversation_id - Conversation ID
   * @param {string} filename - Filename
   * @returns {Promise<object|null>} File metadata or null if not found
   */
  async getFile(conversation_id, filename) {
    try {
      const file = await FileContext.findByFilename(conversation_id, filename);

      if (!file) {
        return null;
      }

      return {
        id: file.id,
        filename: file.filename,
        gemini_file_uri: file.gemini_file_uri,
        gemini_file_name: file.gemini_file_name,
        mime_type: file.mime_type,
        size_bytes: file.size_bytes,
        display_name: file.display_name,
        description: file.description,
        created_at: file.created_at,
        updated_at: file.updated_at,
      };
    } catch (error) {
      logger.error('[FileContextManager] Get file failed', {
        conversation_id,
        filename,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * List all files in conversation context
   * @param {string} conversation_id - Conversation ID
   * @returns {Promise<Array>} Array of file metadata
   */
  async listFiles(conversation_id) {
    try {
      const files = await FileContext.findByConversation(conversation_id);

      return files.map(file => ({
        id: file.id,
        filename: file.filename,
        mime_type: file.mime_type,
        size_bytes: file.size_bytes,
        display_name: file.display_name,
        description: file.description,
        created_at: file.created_at,
      }));
    } catch (error) {
      logger.error('[FileContextManager] List files failed', {
        conversation_id,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Delete file from Gemini API and database
   * @param {string} conversation_id - Conversation ID
   * @param {string} filename - Filename
   * @returns {Promise<boolean>} Success status
   */
  async deleteFile(conversation_id, filename) {
    if (!this.geminiClient) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    try {
      // Get file record
      const file = await FileContext.findByFilename(conversation_id, filename);

      if (!file) {
        throw new Error(`File '${filename}' not found in context`);
      }

      // Delete from Gemini API
      logger.info('[FileContextManager] Deleting file from Gemini', {
        conversation_id,
        filename,
        uri: file.gemini_file_uri,
      });

      await this.geminiClient.deleteFile(file.gemini_file_uri);

      // Delete from database
      await FileContext.deleteByFilename(conversation_id, filename);

      logger.info('[FileContextManager] File deleted successfully', {
        conversation_id,
        filename,
      });

      return true;
    } catch (error) {
      logger.error('[FileContextManager] File deletion failed', {
        conversation_id,
        filename,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Update existing file (delete old, upload new)
   * @param {string} conversation_id - Conversation ID
   * @param {string} filename - Filename
   * @param {Buffer} new_content_buffer - New file content
   * @param {string} mime_type - New MIME type (optional, uses existing if not provided)
   * @returns {Promise<object>} Updated file metadata
   */
  async updateFile(conversation_id, filename, new_content_buffer, mime_type = null) {
    if (!this.geminiClient) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    try {
      // Get existing file record
      const existingFile = await FileContext.findByFilename(conversation_id, filename);

      if (!existingFile) {
        throw new Error(`File '${filename}' not found. Use uploadFile instead.`);
      }

      // Use existing MIME type if not provided
      const finalMimeType = mime_type || existingFile.mime_type;

      logger.info('[FileContextManager] Updating file', {
        conversation_id,
        filename,
        old_uri: existingFile.gemini_file_uri,
      });

      // Delete old file from Gemini API
      await this.geminiClient.deleteFile(existingFile.gemini_file_uri);

      // Upload new file to Gemini API
      const uploadResult = await this.geminiClient.uploadFile(
        new_content_buffer,
        finalMimeType,
        filename
      );

      // Update database record
      await FileContext.update(
        {
          gemini_file_uri: uploadResult.uri,
          gemini_file_name: uploadResult.name,
          mime_type: uploadResult.mimeType,
          size_bytes: uploadResult.sizeBytes,
          updated_at: new Date(),
        },
        {
          where: {
            conversation_id,
            filename,
          },
        }
      );

      // Get updated record
      const updatedFile = await FileContext.findByFilename(conversation_id, filename);

      logger.info('[FileContextManager] File updated successfully', {
        conversation_id,
        filename,
        new_uri: uploadResult.uri,
      });

      return {
        id: updatedFile.id,
        filename: updatedFile.filename,
        gemini_file_uri: updatedFile.gemini_file_uri,
        mime_type: updatedFile.mime_type,
        size_bytes: updatedFile.size_bytes,
        updated_at: updatedFile.updated_at,
      };
    } catch (error) {
      logger.error('[FileContextManager] File update failed', {
        conversation_id,
        filename,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get array of Gemini file URIs for all files in conversation
   * Used to inject files into Gemini context as resources
   * @param {string} conversation_id - Conversation ID
   * @returns {Promise<Array<string>>} Array of Gemini file URIs
   */
  async getConversationFileUris(conversation_id) {
    try {
      const files = await FileContext.findByConversation(conversation_id);

      const uris = files.map(file => file.gemini_file_uri);

      logger.info('[FileContextManager] Retrieved conversation file URIs', {
        conversation_id,
        count: uris.length,
      });

      return uris;
    } catch (error) {
      logger.error('[FileContextManager] Get conversation file URIs failed', {
        conversation_id,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Cleanup all files for a conversation
   * Called when conversation is deleted
   * @param {string} conversation_id - Conversation ID
   * @returns {Promise<number>} Number of files deleted
   */
  async cleanupConversation(conversation_id) {
    if (!this.geminiClient) {
      logger.warn('[FileContextManager] GEMINI_API_KEY not configured, skipping Gemini cleanup');
      // Still delete from database
      const count = await FileContext.deleteByConversation(conversation_id);
      return count;
    }

    try {
      // Get all files for conversation
      const files = await FileContext.findByConversation(conversation_id);

      logger.info('[FileContextManager] Cleaning up conversation files', {
        conversation_id,
        file_count: files.length,
      });

      // Delete each file from Gemini API
      for (const file of files) {
        try {
          await this.geminiClient.deleteFile(file.gemini_file_uri);
        } catch (error) {
          // Log error but continue cleanup
          logger.warn('[FileContextManager] Failed to delete file from Gemini (continuing cleanup)', {
            filename: file.filename,
            uri: file.gemini_file_uri,
            error: error.message,
          });
        }
      }

      // Delete all records from database
      const deletedCount = await FileContext.deleteByConversation(conversation_id);

      logger.info('[FileContextManager] Conversation cleanup completed', {
        conversation_id,
        deleted_count: deletedCount,
      });

      return deletedCount;
    } catch (error) {
      logger.error('[FileContextManager] Conversation cleanup failed', {
        conversation_id,
        error: error.message,
      });
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new FileContextManager();
