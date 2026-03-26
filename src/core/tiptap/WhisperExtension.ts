import { mergeAttributes, Node } from '@tiptap/core';

export interface WhisperOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    whisperNode: {
      setWhisperNode: (attributes: { coverText: string; encryptedSecret: string; originNoteId: string }) => ReturnType;
    };
  }
}

export const WhisperNode = Node.create<WhisperOptions>({
  name: 'whisperNode',

  group: 'inline',
  inline: true,
  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      coverText: {
        default: '',
        parseHTML: element => element.getAttribute('data-cover'),
        renderHTML: attributes => {
          return {
            'data-cover': attributes.coverText,
          };
        },
      },
      encryptedSecret: {
        default: '',
        parseHTML: element => element.getAttribute('data-secret'),
        renderHTML: attributes => {
          return {
            'data-secret': attributes.encryptedSecret,
          };
        },
      },
      originNoteId: {
        default: '',
        parseHTML: element => element.getAttribute('data-origin-id'),
        renderHTML: attributes => {
          return {
            'data-origin-id': attributes.originNoteId,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span.whisper-mark',
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'whisper-mark cursor-pointer',
        'data-type': 'whisperNode',
        contenteditable: 'false',
      }),
      node.attrs.coverText, // Rend the coverText directly inside this atomic block
    ];
  },

  addCommands() {
    return {
      setWhisperNode:
        (attributes) =>
          ({ commands }) => {
            return commands.insertContent({
              type: this.name,
              attrs: attributes,
            });
          },
    };
  },
});
