// Basic Pitch(Spotify, Apache-2.0)를 브라우저용 파일 하나로 묶는 입구. 빌드: tools/build-bp.sh
import * as tf from "@tensorflow/tfjs";
import { BasicPitch, outputToNotesPoly, noteFramesToTime } from "@spotify/basic-pitch";

let model = null;
// audio: 22050Hz 모노 Float32Array. 피아노 녹음에서 동시에 울린 음까지 찾아 [{start, dur, midi, amp}]로 돌려준다.
async function transcribe(audio, modelUrl, onProgress){
  if(!model) model = new BasicPitch(tf.loadGraphModel(modelUrl));
  const frames = [], onsets = [], contours = [];
  await model.evaluateModel(audio, (f, o, c) => { frames.push(...f); onsets.push(...o); contours.push(...c); }, p => onProgress && onProgress(p));
  const notes = noteFramesToTime(outputToNotesPoly(frames, onsets, 0.5, 0.3, 5, true, null, null, true));
  return notes.map(n => ({start:n.startTimeSeconds, dur:n.durationSeconds, midi:n.pitchMidi, amp:n.amplitude})).sort((a,b)=>a.start-b.start);
}
window.SomiBasicPitch = { transcribe, backend: () => tf.getBackend() };
