import { decrypt_bytes } from "./crypto_fns.js";

let quiz_state = null;
let original_crypto_tree = null; // Used for restoring previous state, should not be modified
let SALT = null;
let pswd_chain = []; // Used to track passwords to restore previous state

function savePasswordChain(chain) {
    const encoded = encodeURIComponent(JSON.stringify(chain));
    document.cookie = `pswdChain=${encoded}; max-age=${60 * 60 * 24 * 30}; path=/`;
}

function loadPasswordChain() {
    const match = document.cookie
        .split('; ')
        .find(row => row.startsWith('pswdChain='));
    if (!match) return [];
    return JSON.parse(decodeURIComponent(match.split('=')[1]));
}

function update_quiz_tree_state(new_tree_state, pswd) {
    pswd_chain.push(pswd);
    quiz_state.crypto_tree = new_tree_state;
    savePasswordChain(pswd_chain);
}

function render_question(question_json) {
    document.getElementById("actual_answer").style.display = '';
    document.getElementById("skip").style.display = '';
    document.getElementById("question").innerHTML = question_json.content;
    if (question_json.setter.length > 0) {
        document.getElementById("setter").innerText = "Setter: " + question_json.setter;
    }
    else {
        document.getElementById("setter").innerText = "";
    }
    document.getElementById("result").innerText = '';
    document.getElementById("answer_field").value = '';
    document.getElementById("submit_answer").disabled = false;
}

function render_endgame(n_skips) {
    document.getElementById("actual_answer").style.display = 'none';
    document.getElementById("skip").style.display = 'none';
    const used_skips = original_crypto_tree.skips_remaining - n_skips;
    document.getElementById("result").innerText = `You completed the game using ${used_skips} skips`;
}

function render_skips(n_skips) {
    document.getElementById("skip_count").innerText = n_skips.toString();
    document.getElementById("skip_button").disabled = (n_skips <= 0);
}

function render_back_button(question_number) {
    document.getElementById("back_button").disabled = question_number === 0;
}

function bytesToObject(bytes) {
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json);
}

async function gzipBytesToObject(bytes) {
    const stream = new DecompressionStream('gzip');
    const writer = stream.writable.getWriter();
    writer.write(bytes);
    writer.close();

    const buffer = await new Response(stream.readable).arrayBuffer();
    return bytesToObject(buffer);
}

async function load_active_question(quiz) {
    const encrypted_question = quiz.questions[quiz.crypto_tree.current_question];
    const question_bytes = await decrypt_bytes(encrypted_question, quiz.crypto_tree.question_key, '', quiz.crypto_tree.question_iv);
    const question = await gzipBytesToObject(question_bytes);
    render_question(question);
    render_skips(quiz.crypto_tree.skips_remaining);
    if (quiz.crypto_tree.next_question === null) {
        render_endgame(quiz.crypto_tree.skips_remaining);
    }
    render_back_button(quiz.crypto_tree.current_question);
}

async function submit_answer(quiz, answer, salt) {
    const clean_answer = answer.replace(/\s/g, '').toLowerCase();
    const next_state_bytes = await decrypt_bytes(quiz.crypto_tree.next_question, clean_answer, salt, quiz.crypto_tree.next_question_iv);
    const next_state = await gzipBytesToObject(next_state_bytes)
    update_quiz_tree_state(next_state, clean_answer);
}

async function skip(quiz) {
    update_quiz_tree_state(quiz.crypto_tree.next_question_with_skip, null);
}

export async function skip_pressed() {
    if (quiz_state === null) {
        return;
    }
    if (quiz_state.crypto_tree.next_question_with_skip === null) {
        document.getElementById('result').innerText = 'You have no more skips left';
        return;
    }
    await skip(quiz_state);
    load_active_question(quiz_state);
}

export async function back() {
    // More memory efficient to replay game than to keep lots of
    // previous cyphertext states in memory

    document.getElementById("back_button").disabled = true;
    document.getElementById("skip_button").disabled = true;
    document.getElementById("submit_answer").disabled = true;
    
    try {
        pswd_chain.pop();
        const old_pswds = [...pswd_chain];
        quiz_state.crypto_tree = original_crypto_tree;
        pswd_chain = [];
        for (const pswd of old_pswds) {
            if (pswd === null) {
                await skip(quiz_state);
            }
            else {
                await submit_answer(quiz_state, pswd, SALT);
            }
        }
    }
    catch (e) {
        console.log(e);
        // If something goes wrong here
        // just reset the game rather than risk leaving broken state
        quiz_state.crypto_tree = original_crypto_tree;
        pswd_chain = [];
        savePasswordChain(pswd_chain);
    }
    load_active_question(quiz_state);
}


export async function submit() {
    if (quiz_state === null) {
        return;
    }
    document.getElementById("submit_answer").disabled = true;
    try {
        await submit_answer(quiz_state, document.getElementById("answer_field").value, SALT);
        load_active_question(quiz_state);
    }
    catch (e) {
        if (e.name === 'OperationError') {
            document.getElementById('result').innerText = 'Incorrect solution';
        }
        else {
            console.log(e);
            document.getElementById('result').innerText = 'An error occurred';
        }
    }
    finally {
        document.getElementById("submit_answer").disabled = false;
    }
}

async function load_json(json_path) {
    const response = await fetch(json_path);
    return await response.json();
}

async function load_gz_json(url) {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    return await gzipBytesToObject(bytes);
}

export async function page_load() {
    const config = await load_json('./crypto_config.json');
    SALT = config.SALT;
    quiz_state = await load_gz_json('./quiz.json.gz');
    original_crypto_tree = quiz_state.crypto_tree;

    pswd_chain = loadPasswordChain();
    
    // This lets us restore previous stage from cookies
    pswd_chain.push(null);
    await back();

    load_active_question(quiz_state);
    document.getElementById('submit_answer').addEventListener('click', submit);
    document.getElementById('skip_button').addEventListener('click', skip_pressed);
    document.getElementById('back_button').addEventListener('click', back);
}