const sequelize = require('./index.js');
const { Model, DataTypes } = require("sequelize");

class FileContextTable extends Model {
  /**
   * Find all files for a conversation
   * @param {string} conversation_id
   * @returns {Promise<Array>}
   */
  static async findByConversation(conversation_id) {
    return await this.findAll({
      where: { conversation_id },
      order: [['created_at', 'DESC']]
    });
  }

  /**
   * Find a specific file by conversation and filename
   * @param {string} conversation_id
   * @param {string} filename
   * @returns {Promise<object|null>}
   */
  static async findByFilename(conversation_id, filename) {
    return await this.findOne({
      where: { conversation_id, filename }
    });
  }

  /**
   * Delete a file by conversation and filename
   * @param {string} conversation_id
   * @param {string} filename
   * @returns {Promise<number>} Number of deleted rows
   */
  static async deleteByFilename(conversation_id, filename) {
    return await this.destroy({
      where: { conversation_id, filename }
    });
  }

  /**
   * Delete all files for a conversation
   * @param {string} conversation_id
   * @returns {Promise<number>} Number of deleted rows
   */
  static async deleteByConversation(conversation_id) {
    return await this.destroy({
      where: { conversation_id }
    });
  }
}

const fields = {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false,
    comment: 'File Context ID'
  },
  conversation_id: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'Conversation ID (foreign key)'
  },
  filename: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'User-friendly filename'
  },
  gemini_file_uri: {
    type: DataTypes.STRING(500),
    allowNull: false,
    comment: 'Gemini File API URI (e.g., files/abc123)'
  },
  gemini_file_name: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'Gemini internal file name'
  },
  mime_type: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: 'File MIME type'
  },
  size_bytes: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'File size in bytes'
  },
  display_name: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'Display name in UI'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Optional file description'
  },
  created_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    comment: 'Creation timestamp'
  },
  updated_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    comment: 'Last update timestamp'
  }
};

FileContextTable.init(fields, {
  sequelize,
  modelName: 'file_context',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {
      name: 'idx_file_context_conversation',
      fields: ['conversation_id']
    },
    {
      unique: true,
      name: 'unique_conversation_filename',
      fields: ['conversation_id', 'filename']
    }
  ]
});

module.exports = exports = FileContextTable;
