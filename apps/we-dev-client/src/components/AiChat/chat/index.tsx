import { useEffect, useRef, useState } from "react";
import { useChat } from "ai/react";
import { toast } from "react-toastify";
import { uploadImage } from "@/api/chat";
// import { useChatStore } from "../store/chatStore";
import useChatStore from "../../../stores/chatSlice";
import { useFileStore } from "../../WeIde/stores/fileStore";
import { db } from "../../../utils/indexDB";
import { v4 as uuidv4 } from "uuid";
import { eventEmitter } from "../utils/EventEmitter";
import { MessageItem } from "./components/MessageItem";
import { ChatInput, ChatMode } from "./components/ChatInput";
import { parseMessage } from "../../../utils/messagepParseJson";
import useUserStore from "../../../stores/userSlice";
import { useLimitModalStore } from "../../UserModal";
import { syncFileSystem, updateFileSystemNow } from "../../WeIde/services";
import { newTerminal } from "../../WeIde/components/Terminal/utils/commands";
const ipcRenderer = (window as any)?.electron?.ipcRenderer;
// import useUserStore from "@/stores/userSlice";
import { parseMessages } from "../useMessageParser";
import { createMpIcon } from "@/utils/createWtrite";
import { useTranslation } from "react-i18next";
import useChatModeStore from "../../../stores/chatModeSlice";
import { getSystemPrompt } from "@/utils/prompt";
import Ollama from "@/icon/Ollama";

export const excludeFiles = [
  "components/weicon/base64.js",
  "components/weicon/icon.css",
  "components/weicon/index.js",
  "components/weicon/index.json",
  "components/weicon/index.wxml",
  "components/weicon/icondata.js",
  "components/weicon/index.css",
  "/miniprogram/components/weicon/base64.js",
  "/miniprogram/components/weicon/icon.css",
  "/miniprogram/components/weicon/index.js",
  "/miniprogram/components/weicon/index.json",
  "/miniprogram/components/weicon/index.wxml",
  "/miniprogram/components/weicon/icondata.js",
  "/miniprogram/components/weicon/index.css",
]


const API_BASE = process.env.APP_BASE_URL;
enum ModelTypes {
  Claude35sonnet = "claude-3-5-sonnet-20240620",
  gpt4oMini = "gpt-4o-mini",
  DeepseekR1 = "DeepSeek-R1",
  DeepseekV3 = "deepseek-chat",
}
export interface IModelOption {
  value: string;
  label: string;
  useImage: boolean;
  from?: string;
  icon?: React.FC<React.SVGProps<SVGSVGElement>>;
  provider?: string;
}

function convertToBoltAction(obj: Record<string, string>): string {
  return Object.entries(obj)
    .filter(([filePath]) => (!excludeFiles.includes(filePath)) )
    .map(
      ([filePath, content]) =>
        `<boltAction type="file" filePath="${filePath}">\n${content}\n</boltAction>`
    )
    .join("\n\n");
}

export const BaseChat = ({ uuid: propUuid }: { uuid?: string }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  const [baseModal, setBaseModal] = useState<IModelOption>({
    value: ModelTypes.Claude35sonnet,
    label: "Claude 3.5 Sonnet",
    useImage: true,
    from: "default",
  });
  const {
    files,
    isFirstSend,
    isUpdateSend,
    setIsFirstSend,
    setIsUpdateSend,
    setFiles,
    setEmptyFiles,
    errors,
    clearErrors,
  } = useFileStore();
  const { mode } = useChatModeStore();
  // 使用全局状态
  const {
    uploadedImages,
    addImages,
    removeImage,
    clearImages,
    ollamaConfig,
    setModelOptions,
  } = useChatStore();
  const filesInitObj = {} as Record<string, string>;
  const filesUpdateObj = {} as Record<string, string>;

  Object.keys(isFirstSend).forEach((key) => {
    isFirstSend[key] && (filesInitObj[key] = files[key]);
  });
  Object.keys(isUpdateSend).forEach((key) => {
    isUpdateSend[key] && (filesUpdateObj[key] = files[key]);
  });

  const initConvertToBoltAction = convertToBoltAction({
    ...filesInitObj,
    ...filesUpdateObj,
  });
  const updateConvertToBoltAction = convertToBoltAction(filesUpdateObj);

  // 使用 ollama 模型 获取模型列表
  useEffect(() => {
    fetch(`${API_BASE}/api/model`,{
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    })
      .then((res) => res.json())
      .then((data) => {
        setModelOptions(data);
      }).catch((error) => {
        console.error("Failed to fetch model list:", error);
      });
  }, []);


  useEffect(() => {
    if (
      (messages.length === 0 && initConvertToBoltAction) ||
      (messages.length === 1 &&
        messages[0].id === "1" &&
        initConvertToBoltAction)
    ) {
      setMessages([
        {
          id: "1",
          role: "user",
          content: `<boltArtifact id="hello-js" title="the current file">\n${initConvertToBoltAction}\n</boltArtifact>\n\n`,
        },
      ]);
    }
  }, [initConvertToBoltAction]);

  useEffect(() => {
    if (messages.length > 1 && updateConvertToBoltAction) {
      setMessages((list) => {
        const newList = [...list];
        if (newList[newList.length - 1].id !== "2") {
          newList.push({
            id: "2",
            role: "user",
            content: `<boltArtifact id="hello-js" title="Currently modified files">\n${updateConvertToBoltAction}\n</boltArtifact>\n\n`,
          });
        } else if (newList[newList.length - 1].id === "2") {
          newList[newList.length - 1].content =
            `<boltArtifact id="hello-js" title="Currently modified files">\n${updateConvertToBoltAction}\n</boltArtifact>\n\n`;
        }
        return newList;
      });
    }
  }, [updateConvertToBoltAction]);

  // 修改 UUID 的初始化逻辑和消息加载
  const [chatUuid, setChatUuid] = useState(() => propUuid || uuidv4());

  const refUuidMessages = useRef([]);

  // 添加加载历史消息的函数
  const loadChatHistory = async (uuid: string) => {
    try {
      const records = await db.getByUuid(uuid);
      if (records.length > 0) {
        const latestRecord = records[0];
        if (latestRecord?.data?.messages) {
          const historyFiles = {};
          latestRecord.data.messages.forEach((message) => {
            const { files: messageFiles } = parseMessage(message.content);
            Object.assign(historyFiles, messageFiles);
          });
          latestRecord.data.messages.push({
            id: uuidv4(),
            role: "user",
            content: `<boltArtifact id="hello-js" title="the current file">\n${convertToBoltAction(historyFiles)}\n</boltArtifact>\n\n`,
          });
          setMessages(latestRecord.data.messages);
          setFiles(historyFiles);
          // 重置其他状态
          clearImages();
          setIsFirstSend();
          setIsUpdateSend();
        }
      } else {
        // 如果是新对话，清空所有状态
        setMessages([]);
        clearImages();
        setIsFirstSend();
        setIsUpdateSend();
      }
    } catch (error) {
      console.error("Failed to load chat history:", error);
      toast.error("加载聊天记录失败");
    }
  };

  // 监听聊天选择事件
  useEffect(() => {
    const unsubscribe = eventEmitter.on("chat:select", (uuid: string) => {
      if (uuid !== chatUuid) {
        refUuidMessages.current = []
        setChatUuid(uuid || uuidv4());
        if (uuid) {
          // 加载历史记录
          loadChatHistory(uuid);
        } else {
          // 新对话，清空所有状态
          setMessages([]);
          setFiles({});
          clearImages();
          setIsFirstSend();
          setIsUpdateSend();
          if (ipcRenderer) {
            setEmptyFiles();
            ipcRenderer.invoke("node-container:set-now-path", "");
            setFiles({});
            clearImages();
            setIsFirstSend();
            setIsUpdateSend();
            newTerminal();
          }
        }
      }
    });

    // 清理订阅
    return () => unsubscribe();
  }, [chatUuid, files]);
  const token = useUserStore.getState().token;
  const { openModal } = useLimitModalStore();
  
  const baseChatUrl =
    baseModal.from === "ollama" ? `${ollamaConfig.url}` : `${API_BASE}`;
  // 修改 useChat 配置
  const {
    messages,
    input,
    handleInputChange,
    isLoading,
    setMessages,
    append,
    setInput,
  } = useChat({
    api: `${baseChatUrl}/api/chat`,
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: {
      model: baseModal.value,
      mode: mode,
    },
    id: chatUuid,
    onResponse: async (response) => {
      if (baseModal.from === "ollama") {
        const reader = response.body?.getReader();
        if (!reader) return;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = new TextDecoder().decode(value);
          const lines = text.split('\n').filter(line => line.trim());
          
          for (const line of lines) {
            try {
              const data = JSON.parse(line);
              if (data.message?.content) {
                setMessages(messages => {
                  const lastMessage = messages[messages.length - 1];
                  if (lastMessage && lastMessage.role === "assistant") {
                    return [
                      ...messages.slice(0, -1),
                      {
                        ...lastMessage,
                        content: lastMessage.content + data.message.content
                      }
                    ];
                  }
                  return [
                    ...messages,
                    {
                      id: uuidv4(),
                      role: "assistant", 
                      content: data.message.content
                    }
                  ];
                });
              }
            } catch (e) {
              console.warn("Failed to parse Ollama response line:", e);
            }
          }
        }
      }
    },
    onFinish: async (message: any) => {
      setIsFirstSend();
      setIsUpdateSend();
      clearImages();
      scrollToBottom();
      try {
        await db.insert(chatUuid, {
          messages: [...messages, message],
          title:
            messages
              .find(
                (m) => m.role === "user" && !m.content.includes("<boltArtifact")
              )
              ?.content?.slice(0, 50) || "New Chat",
        });
        setTimeout(() => {
          const needParseMessages = [...messages, message].filter((m) => !refUuidMessages.current.includes(m.id));
          refUuidMessages.current = [...refUuidMessages.current, ...needParseMessages.map((m) => m.id)];
          parseMessages(needParseMessages as any);
        }, 100)
      } catch (error) {
        console.error("Failed to save chat history:", error);
      }
    },
    onError: (error) => {
      console.log(String(error), "error");
      if (String(error).includes("Authentication required")) {
        openModal();
      }
      // 添加对 Ollama 错误的处理
      if (baseModal.from === "ollama") {
        toast.error("Ollama 服务器连接失败，请检查配置");
      }
    },
  });




  const parseTimeRef = useRef(0);

  useEffect(() => {
    const visibleFun = () => {
      if(isLoading) return
       else if(!isLoading && window.electron) {
        setTimeout(() => {
          updateFileSystemNow()
        }, 600)
      }
    }
    document.addEventListener('visibilitychange', visibleFun);
    return () => {
      document.removeEventListener('visibilitychange', visibleFun);
    }
  }, [isLoading, files])

  useEffect(() => {
    if (Date.now() - parseTimeRef.current > 500 && isLoading) {
      parseTimeRef.current = Date.now();

      const needParseMessages = messages.filter((m) => !refUuidMessages.current.includes(m.id));
      parseMessages(needParseMessages as any);
      scrollToBottom()
    }
    if (errors.length > 0 && isLoading) {
      clearErrors();
    }
    if (!isLoading) {

      createMpIcon(files);
    }
  }, [messages, isLoading]);

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    }
  };


  // 添加上传状态跟踪
  const [isUploading, setIsUploading] = useState(false);

  // 修改上传处理函数
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length || isUploading) return;
    setIsUploading(true);

    const selectedFiles = Array.from(e.target.files);
    const MAX_FILE_SIZE = 5 * 1024 * 1024;

    const validFiles = selectedFiles.filter((file) => {
      if (file.size > MAX_FILE_SIZE) {
        toast.error(t("chat.errors.file_size_limit", { fileName: file.name }));
        return false;
      }
      return true;
    });

    try {
      const uploadResults = await Promise.all(
        validFiles.map(async (file) => {
          const url = await uploadImage(file);
          return {
            id: uuidv4(),
            file,
            url,
            localUrl: URL.createObjectURL(file),
            status: "done" as const,
          };
        })
      );

      addImages(uploadResults);
      if (uploadResults.length === 1) {
        toast.success(t("chat.success.images_uploaded"));
      } else {
        toast.success(
          t("chat.success.images_uploaded_multiple", {
            count: uploadResults.length,
          })
        );
      }
    } catch (error) {
      console.error("Upload failed:", error);
      toast.error(t("chat.errors.upload_failed"));
    } finally {
      setIsUploading(false);
    }

    e.target.value = "";
  };

  // 修改提交处理函数
  const handleSubmitWithFiles = async (e: any, text?: string) => {
    if (!text && !input.trim() && uploadedImages.length === 0) return;

    try {
      // 处理文件引用
      // const processedInput = await processFileReferences(input);
      // 如果是 ollama类型 模型 需要走单独逻辑，不走云端

      // 保存当前的图片附件
      const currentAttachments = uploadedImages.map((img) => ({
        id: img.id,
        name: img.id,
        type: img.file.type,
        localUrl: img.localUrl,
        contentType: img.file.type,
        url: img.url,
      }));

      // 先清理图片状态
      clearImages();

      append(
        {
          role: "user",
          content: text || input,
        },
        {
          experimental_attachments: currentAttachments,
        }
      );
      setInput("");
      setTimeout(() => {
        scrollToBottom();
      }, 100);
    } catch (error) {
      console.error("Upload failed:", error);
      toast.error("Failed to upload files");
    }
  };

  // 修改键盘提交处理
  const handleKeySubmit = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmitWithFiles(e as any);
    }
  };

  // 修改粘贴处理函数
  const handlePaste = async (e: ClipboardEvent) => {
    if (isUploading) return;

    const items = e.clipboardData?.items;
    if (!items) return;

    const hasImages = Array.from(items).some(
      (item) => item.type.indexOf("image") !== -1
    );
    if (hasImages) {
      e.preventDefault();
      setIsUploading(true);

      const imageItems = Array.from(items).filter(
        (item) => item.type.indexOf("image") !== -1
      );

      try {
        const uploadResults = await Promise.all(
          imageItems.map(async (item) => {
            const file = item.getAsFile();
            if (!file) throw new Error("Failed to get file from clipboard");

            const url = await uploadImage(file);
            return {
              id: uuidv4(),
              file,
              url,
              localUrl: URL.createObjectURL(file),
              status: "done" as const,
            };
          })
        );

        addImages(uploadResults);

        if (uploadResults.length === 1) {
          toast.success(t("chat.success.image_pasted"));
        } else {
          toast.success(
            t("chat.success.images_pasted_multiple", {
              count: uploadResults.length,
            })
          );
        }
      } catch (error) {
        console.error("Failed to upload pasted images:", error);
        toast.error(t("chat.errors.paste_failed"));
      } finally {
        setIsUploading(false);
      }
    }
  };

  // 添加粘贴事件监听
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.addEventListener("paste", handlePaste);
    return () => {
      textarea.removeEventListener("paste", handlePaste);
    };
  }, []);

  // 添加拖拽处理函数
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isUploading) return;
    setIsUploading(true);

    try {
      const items = Array.from(e.dataTransfer.items);
      const imageItems = items.filter((item) => item.type.startsWith("image/"));

      const uploadResults = await Promise.all(
        imageItems.map(async (item) => {
          const file = item.getAsFile();
          if (!file) throw new Error("Failed to get file from drop");

          const url = await uploadImage(file);
          return {
            id: uuidv4(),
            file,
            url,
            localUrl: URL.createObjectURL(file),
            status: "done" as const,
          };
        })
      );

      addImages(uploadResults);

      if (uploadResults.length === 1) {
        toast.success("图片已添加到输入框");
      } else {
        toast.success(`${uploadResults.length} 张图片已添加到输入框`);
      }
    } catch (error) {
      console.error("Failed to process dropped images:", error);
      toast.error("添加图片失败");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div
      className="flex flex-col h-full   dark:bg-[rgba(30,30,30)] max-w-full"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="flex-1 overflow-y-auto px-1 py-2 message-container [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <div className="max-w-[640px] w-full mx-auto space-y-3">
          {messages.map((message, index) => (
            <MessageItem
              key={`${message.id}-${index}`}
              message={message as any}
              isLoading={isLoading}
              messages={messages}
            />
          ))}

          {isLoading && (
            <div className="group" key="loading-indicator">
              <div className="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.02] transition-colors">
                <div className="w-6 h-6 rounded-md bg-[rgba(45,45,45)] text-gray-400 flex items-center justify-center text-xs border border-gray-700/50">
                  <svg
                    className="w-4 h-4 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="3"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-24 bg-gray-700/50 rounded animate-pulse" />
                    <div className="h-4 w-32 bg-gray-700/50 rounded animate-pulse" />
                    <div className="h-4 w-16 bg-gray-700/50 rounded animate-pulse" />
                  </div>
                  <div className="mt-2 space-y-2">
                    <div className="h-3 w-full bg-gray-700/50 rounded animate-pulse" />
                    <div className="h-3 w-4/5 bg-gray-700/50 rounded animate-pulse" />
                  </div>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} className="h-px" />
        </div>
      </div>

      <ChatInput
        input={input}
        isLoading={isLoading}
        isUploading={isUploading}
        uploadedImages={uploadedImages}
        baseModal={baseModal}
        handleInputChange={handleInputChange}
        handleKeySubmit={handleKeySubmit}
        handleSubmitWithFiles={handleSubmitWithFiles}
        handleFileSelect={handleFileSelect}
        removeImage={removeImage}
        addImages={addImages}
        setIsUploading={setIsUploading}
        setBaseModal={setBaseModal}
      />

      {messages.length === 0 && (
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
          <div className="flex flex-col gap-2">
            {/* 示例提示区域保持不变 */}
          </div>
        </div>
      )}
    </div>
  );
};
