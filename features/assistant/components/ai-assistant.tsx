"use client"

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent } from "react"
import { ArrowUp, ImagePlus, Sparkles, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import type { AssistantData } from "../types"

type Img = { url: string; name: string }
type Msg = { from: "ai" | "me"; text: string; images?: Img[] }

const MAX_IMAGES = 4
const MAX_BYTES = 5 * 1024 * 1024

// Demo only: answers come from canned replies in public/data/layout/assistant.json.
function answer(data: AssistantData, q: string) {
  const l = q.toLowerCase()
  return data.replies.find((r) => r.match.some((m) => l.includes(m)))?.text ?? data.fallback
}

export function AiAssistant({ data }: { data: AssistantData }) {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([{ from: "ai", text: data.greeting }])
  const [input, setInput] = useState("")
  const [typing, setTyping] = useState(false)
  const [pending, setPending] = useState<Img[]>([])
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState("")
  const end = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const urls = useRef<string[]>([])

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [msgs, typing])

  // Object URLs live for the whole chat; release them when the component goes away.
  useEffect(() => () => urls.current.forEach(URL.revokeObjectURL), [])

  const addFiles = (files: FileList | File[]) => {
    const imgs = Array.from(files).filter((f) => f.type.startsWith("image/"))
    if (!imgs.length) return
    const ok = imgs.filter((f) => f.size <= MAX_BYTES).slice(0, MAX_IMAGES - pending.length)
    setError(
      ok.length < imgs.length ? `Up to ${MAX_IMAGES} images, 5 MB each.` : ""
    )
    const next = ok.map((f) => {
      const url = URL.createObjectURL(f)
      urls.current.push(url)
      return { url, name: f.name }
    })
    setPending((p) => [...p, ...next])
  }

  const removePending = (url: string) => {
    URL.revokeObjectURL(url)
    urls.current = urls.current.filter((u) => u !== url)
    setPending((p) => p.filter((i) => i.url !== url))
    setError("")
  }

  const ask = (q: string, images: Img[] = []) => {
    const text = q.trim()
    if ((!text && !images.length) || typing) return
    setMsgs((m) => [...m, { from: "me", text, images }])
    setInput("")
    setPending([])
    setError("")
    setTyping(true)
    setTimeout(() => {
      setMsgs((m) => [...m, { from: "ai", text: images.length ? data.imageReply : answer(data, text) }])
      setTyping(false)
    }, 900)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    ask(input, pending)
  }

  const onPaste = (e: ClipboardEvent) => {
    if (e.clipboardData.files.length) {
      e.preventDefault()
      addFiles(e.clipboardData.files)
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon-lg"
        className="icon-btn ai-btn"
        aria-label="AI assistant"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Sparkles className="ico" />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="ai-panel"
          data-dragging={dragging || undefined}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
          }}
          onDrop={onDrop}
        >
          {dragging && (
            <div className="ai-drop" aria-hidden="true">
              <ImagePlus />
              Drop images here
            </div>
          )}
          <div className="ai-head">
            <span className="ai-mark"><Sparkles /></span>
            <div className="ai-head-tx">
              <SheetTitle className="ai-title">{data.title}</SheetTitle>
              <SheetDescription className="ai-sub">{data.subtitle}</SheetDescription>
            </div>
            <SheetClose render={<Button variant="ghost" size="icon" className="ai-close" aria-label="Close assistant" />}>
              <X />
            </SheetClose>
          </div>

          <div className="ai-body">
            {msgs.map((m, i) => (
              <div key={i} className={`ai-msg ${m.from}${m.images?.length ? " has-img" : ""}`}>
                {!!m.images?.length && (
                  <div className="ai-msg-imgs" data-count={m.images.length}>
                    {m.images.map((img) => (
                      // eslint-disable-next-line @next/next/no-img-element -- local blob URL, next/image can't optimise it
                      <img key={img.url} src={img.url} alt={img.name} />
                    ))}
                  </div>
                )}
                {m.text && <span>{m.text}</span>}
              </div>
            ))}
            {typing && (
              <div className="ai-msg ai typing" aria-label="Assistant is typing">
                <i /><i /><i />
              </div>
            )}
            {msgs.length === 1 && (
              <div className="ai-chips">
                {data.suggestions.map((s) => (
                  <button key={s} type="button" onClick={() => ask(s)}>{s}</button>
                ))}
              </div>
            )}
            <div ref={end} />
          </div>

          <form className="ai-compose" onSubmit={submit}>
            {(pending.length > 0 || error) && (
              <div className="ai-attach">
                {pending.map((img) => (
                  <span key={img.url} className="ai-thumb">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
                    <img src={img.url} alt={img.name} />
                    <button type="button" onClick={() => removePending(img.url)} aria-label={`Remove ${img.name}`}>
                      <X />
                    </button>
                  </span>
                ))}
                {error && <span className="ai-attach-err">{error}</span>}
              </div>
            )}
            <div className="ai-input">
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files)
                  e.target.value = ""
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="ai-attach-btn"
                aria-label="Attach image"
                disabled={pending.length >= MAX_IMAGES}
                onClick={() => fileInput.current?.click()}
              >
                <ImagePlus />
              </Button>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onPaste={onPaste}
                placeholder="Ask OpsDesk AI…"
                aria-label="Message OpsDesk AI"
              />
              <Button
                type="submit"
                size="icon"
                className="ai-send"
                disabled={(!input.trim() && !pending.length) || typing}
                aria-label="Send"
              >
                <ArrowUp />
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </>
  )
}
