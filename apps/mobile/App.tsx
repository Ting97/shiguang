import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform,
  Pressable, StyleSheet, Text, TextInput, View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { Audio } from "expo-av";
import { getToken, loadFeed, login, sendText, transcribe, type Moment } from "./src/api";

const C = {
  bg: "#020617", card: "#0f172a", line: "#1e293b",
  ink: "#f1f5f9", dim: "#94a3b8", accent: "#38bdf8",
  amber: "#f1c66b", danger: "#f43f5e", ok: "#34d399",
};

export default function App() {
  const [ready, setReady] = useState(false);
  const [token, setTokenState] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setTokenState(await getToken());
      setReady(true);
    })();
  }, []);

  if (!ready) {
    return <Center><ActivityIndicator color={C.accent} /></Center>;
  }
  return token ? <Home onLogout={() => setTokenState(null)} /> : <Login onOk={() => setTokenState("1")} />;
}

// —— 登录 ——

function Login({ onOk }: { onOk: () => void }) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      await login(phone.trim(), password);
      onOk();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <StatusBar style="light" />
      <Text style={s.logo}>☀️</Text>
      <Text style={s.title}>拾光</Text>
      <Text style={s.sub}>钱 · 时间 · 人，一句话记下来</Text>
      <TextInput
        style={s.input} placeholder="手机号 / 邮箱" placeholderTextColor={C.dim}
        autoCapitalize="none" keyboardType="email-address" value={phone} onChangeText={setPhone}
      />
      <TextInput
        style={s.input} placeholder="密码" placeholderTextColor={C.dim}
        secureTextEntry value={password} onChangeText={setPassword}
      />
      {err && <Text style={s.err}>{err}</Text>}
      <Pressable style={[s.btn, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
        {busy ? <ActivityIndicator color="#020617" /> : <Text style={s.btnText}>登录</Text>}
      </Pressable>
      <Text style={s.hint}>短信验证码登录请使用网页版 · 注册需邀请码</Text>
    </KeyboardAvoidingView>
  );
}

// —— 主界面（动态流 + 语音/文字速记） ——

function Home({ onLogout }: { onLogout: () => void }) {
  const [moments, setMoments] = useState<Moment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMoments(await loadFeed());
    } catch (e) {
      if (e instanceof Error && e.message.includes("401")) onLogout();
    } finally {
      setLoading(false);
    }
  }, [onLogout]);

  useEffect(() => {
    refresh();
    const t = setTimeout(refresh, 6000); // 发动态后延迟再刷一次，呈现识别产物
    return () => clearTimeout(t);
  }, [refresh]);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), msg.ok ? 3500 : 8000);
    return () => clearTimeout(t);
  }, [msg]);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      await sendText(t);
      setText("");
      setMsg({ ok: true, text: "✅ 已记录，AI 识别中…" });
      setTimeout(refresh, 6000);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "发送失败" });
    } finally {
      setSending(false);
    }
  };

  const toggleRecord = async () => {
    if (recording) {
      setRecording(null);
      setTranscribing(true);
      try {
        await recording.stopAndUnloadAsync();
        const uri = recording.getURI();
        if (!uri) throw new Error("录音不可用");
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
        const text = await transcribe(uri);
        if (!text) throw new Error("没有听清内容，请再试一次");
        await sendText(text);
        setMsg({ ok: true, text: `🎙 已记录：${text}` });
        setTimeout(refresh, 6000);
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : "识别失败" });
      } finally {
        setTranscribing(false);
      }
      return;
    }
    try {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      // 16kHz 单声道 PCM WAV（GLM-ASR 全平台稳）
      const { recording: rec } = await Audio.Recording.createAsync({
        android: {
          extension: ".wav",
          outputFormat: Audio.AndroidOutputFormat.DEFAULT,
          audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 256000,
        },
        ios: {
          extension: ".wav",
          outputFormat: Audio.IOSOutputFormat.LINEARPCM,
          audioQuality: Audio.IOSAudioQuality.HIGH,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 256000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: {
          mimeType: "audio/wav",
          bitsPerSecond: 256000,
        },
      });
      setRecording(rec);
      setMsg({ ok: true, text: "🎙 录音中…再点一次结束" });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "无法开始录音" });
    }
  };

  return (
    <View style={s.root}>
      <StatusBar style="light" />
      <View style={s.header}>
        <Text style={s.headerTitle}>拾光</Text>
        <Pressable onPress={onLogout}><Text style={s.logout}>退出</Text></Pressable>
      </View>
      {msg && <Text style={[s.banner, { color: msg.ok ? C.ok : C.danger }]}>{msg.text}</Text>}
      {loading ? (
        <Center><ActivityIndicator color={C.accent} /></Center>
      ) : (
        <FlatList
          data={moments}
          keyExtractor={(x) => x.id}
          contentContainerStyle={s.list}
          renderItem={({ item }) => <MomentCard m={item} />}
          ListEmptyComponent={<Text style={s.empty}>还没有动态，说一句话开始 ✨</Text>}
        />
      )}
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={s.composer}>
          <Pressable
            style={[s.mic, (recording || transcribing) && s.micActive]}
            onPress={toggleRecord}
            disabled={transcribing}
          >
            {transcribing ? <ActivityIndicator color="#020617" /> : <Text style={s.micIcon}>{recording ? "⏹" : "🎙"}</Text>}
          </Pressable>
          <TextInput
            style={s.composerInput} placeholder="一句话记录…" placeholderTextColor={C.dim}
            value={text} onChangeText={setText} multiline
          />
          <Pressable style={[s.send, (!text.trim() || sending) && { opacity: 0.5 }]} onPress={send} disabled={!text.trim() || sending}>
            {sending ? <ActivityIndicator color="#020617" size="small" /> : <Text style={s.btnText}>发送</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function MomentCard({ m }: { m: Moment }) {
  const yuan = (cents: number) => `¥${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <Text style={s.cardTime}>
          {new Date(m.created_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
        </Text>
        {m.mood && <Text style={s.cardMood}>😊 {m.mood}</Text>}
      </View>
      <Text style={s.cardText}>{m.raw_text}</Text>
      {(m.blocks.length > 0 || m.todos.length > 0 || m.transactions.length > 0) && (
        <View style={s.chips}>
          {m.blocks.length > 0 && <Text style={s.chip}>🕒 {m.blocks.length} 日程</Text>}
          {m.todos.length > 0 && <Text style={s.chip}>📋 {m.todos.length} 待办</Text>}
          {m.transactions.map((tx) => (
            <Text key={tx.id} style={[s.chip, { color: tx.direction === "in" ? C.ok : C.amber }]}>
              💰 {tx.direction === "in" ? "+" : "-"}{yuan(tx.amount_cents)}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <View style={[s.root, s.center]}>{children}</View>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: "center", justifyContent: "center" },
  logo: { fontSize: 56, textAlign: "center" },
  title: { color: C.ink, fontSize: 24, fontWeight: "700", textAlign: "center", marginTop: 8 },
  sub: { color: C.dim, fontSize: 13, textAlign: "center", marginTop: 6, marginBottom: 28 },
  input: {
    backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 12,
    color: C.ink, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15,
    marginBottom: 12, width: 280,
  },
  err: { color: C.danger, fontSize: 12, marginBottom: 10 },
  btn: {
    backgroundColor: C.amber, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 32,
    alignItems: "center", width: 280,
  },
  btnText: { color: "#020617", fontWeight: "700", fontSize: 15 },
  hint: { color: C.dim, fontSize: 11, marginTop: 18, textAlign: "center" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingTop: 54, paddingBottom: 10,
  },
  headerTitle: { color: C.ink, fontSize: 18, fontWeight: "700" },
  logout: { color: C.dim, fontSize: 13 },
  banner: { fontSize: 12, paddingHorizontal: 16, paddingBottom: 6 },
  list: { paddingHorizontal: 16, paddingBottom: 12 },
  empty: { color: C.dim, textAlign: "center", marginTop: 60 },
  card: {
    backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 16,
    padding: 14, marginBottom: 10,
  },
  cardHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  cardTime: { color: C.dim, fontSize: 11 },
  cardMood: { color: C.amber, fontSize: 11 },
  cardText: { color: C.ink, fontSize: 15, lineHeight: 22 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  chip: {
    color: C.accent, backgroundColor: C.bg, borderColor: C.line, borderWidth: 1,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, fontSize: 11, overflow: "hidden",
  },
  composer: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    paddingHorizontal: 12, paddingTop: 8, paddingBottom: 24,
  },
  mic: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: C.amber,
    alignItems: "center", justifyContent: "center",
  },
  micActive: { backgroundColor: C.danger },
  micIcon: { fontSize: 20 },
  composerInput: {
    flex: 1, minHeight: 44, maxHeight: 100, backgroundColor: C.card,
    borderColor: C.line, borderWidth: 1, borderRadius: 14, color: C.ink,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
  },
  send: {
    backgroundColor: C.accent, borderRadius: 14, paddingHorizontal: 16,
    height: 44, alignItems: "center", justifyContent: "center",
  },
});
