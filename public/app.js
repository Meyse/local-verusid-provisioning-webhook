(() => {
  const parentSelect = document.getElementById("parent-id");
  const webhookBaseUrlInput = document.getElementById("webhook-base-url");
  const responseUriInput = document.getElementById("response-uri");
  const qrForm = document.getElementById("qr-form");
  const qrStatus = document.getElementById("qr-status");
  const qrResult = document.getElementById("qr-result");
  const qrImage = document.getElementById("qr-image");
  const deeplink = document.getElementById("deeplink");
  const requestsList = document.getElementById("requests-list");
  const requestTemplate = document.getElementById("request-template");
  const expandedRequests = new Set();
  let lastDefaultResponseUri = responseUriInput.value;

  const setStatus = (message, error = false) => {
    qrStatus.textContent = message;
    qrStatus.classList.toggle("error", error);
  };

  const fetchJson = async (url, options) => {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `Request failed with ${response.status}`);
    }
    return data;
  };

  const copyText = async (value) => {
    await navigator.clipboard.writeText(value);
  };

  const setText = (node, field, value) => {
    node.querySelector(`[data-field='${field}']`).textContent = value;
  };

  const setCopyableText = (node, field, value, emptyLabel = "Not available") => {
    setText(node, field, value || emptyLabel);

    const button = node.querySelector(`[data-copy-field='${field}']`);
    if (!button) return;

    button.hidden = !value;
    if (!value) return;

    button.addEventListener("click", async () => {
      await copyText(value);
      button.textContent = "Copied";
      setTimeout(() => {
        button.textContent = "Copy";
      }, 1200);
    });
  };

  const humanizeState = (value, emptyLabel = "Waiting") => {
    if (!value) return emptyLabel;
    return String(value)
      .replace(/_/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  };

  const formatTimestamp = (seconds) => {
    if (!seconds) return "Not available";
    return new Date(seconds * 1000).toLocaleString();
  };

  const defaultResponseUri = () => {
    return `${webhookBaseUrlInput.value.trim().replace(/\/+$/g, "")}/generic-response`;
  };

  const syncDefaultResponseUri = () => {
    const nextDefault = defaultResponseUri();
    const current = responseUriInput.value.trim();
    if (!current || current === lastDefaultResponseUri) {
      responseUriInput.value = nextDefault;
    }
    lastDefaultResponseUri = nextDefault;
  };

  const commitmentStage = (request) => {
    if (request.status === "failed") return "Failed";
    const txid = request.automation?.commitmentTxid;
    const confirmations = request.automation?.commitmentConfirmations || 0;
    if (txid && confirmations > 0) return "Confirmed";
    if (txid) return "Submitted";
    if (request.walletSigningAddress) return "Queued";
    return "Waiting for wallet";
  };

  const registrationStage = (request) => {
    if (request.status === "failed") return "Failed";
    if (request.status === "ready" || request.automation?.state === "complete") {
      return "Identity ready";
    }
    if (request.automation?.registrationTxid) return "Submitted";
    if ((request.automation?.commitmentConfirmations || 0) > 0) {
      return "Ready to register";
    }
    return "Not started";
  };

  const genericResponseStage = (request) => {
    if (request.genericResponse?.verified) return "Received";
    if (request.genericResponse) return "Failed verification";
    if (request.responseUri) return "Waiting";
    return "Not requested";
  };

  const genericResponseDetail = (request) => {
    if (request.genericResponse?.verified) {
      return `Verified at ${formatTimestamp(request.genericResponse.receivedAt)}`;
    }
    if (request.genericResponseError) return request.genericResponseError;
    if (request.genericResponse) return "Received but not verified";
    if (request.responseUri) return "Waiting for mobile completion";
    return "Not requested";
  };

  const formatCommitmentConfirmations = (request) => {
    const confirmations = request.automation?.commitmentConfirmations;
    if (confirmations == null) return "Not checked yet";
    if (request.automation?.registrationTxid || request.automation?.state === "complete") {
      return `${confirmations} when registration was submitted`;
    }
    return String(confirmations);
  };

  const loadParents = async () => {
    parentSelect.innerHTML = "<option value=\"\">Loading...</option>";
    try {
      const data = await fetchJson("/api/parents");
      if (!data.parents.length) {
        parentSelect.innerHTML = "<option value=\"\">No local identities found</option>";
        return;
      }

      parentSelect.innerHTML = data.parents
        .map((parent) => {
          const label = `${parent.fullyQualifiedName} (${parent.iAddress})`;
          return `<option value="${parent.iAddress}">${label}</option>`;
        })
        .join("");
    } catch (error) {
      parentSelect.innerHTML = "<option value=\"\">Failed to load parents</option>";
      setStatus(error.message, true);
    }
  };

  const renderRequests = async () => {
    try {
      const data = await fetchJson("/api/requests");
      requestsList.innerHTML = "";

      if (!data.requests.length) {
        requestsList.innerHTML = "<p class=\"empty\">No provisioning requests yet.</p>";
        return;
      }

      for (const request of data.requests) {
        const node = requestTemplate.content.firstElementChild.cloneNode(true);
        const commitmentTxid = request.automation?.commitmentTxid || "";
        const registrationTxid = request.automation?.registrationTxid || "";
        const automationState = request.automation?.state || "Waiting for wallet submission";
        const walletSigningAddress =
          request.walletSigningAddress || "Waiting for wallet submission";
        const requestedIdentityAddress =
          request.requestedIdentityAddress || "Waiting for wallet submission";
        const automationError = request.automation?.lastError || "";
        const genericResponseSigner = request.genericResponse?.signerIdentityId || "";
        const rawGenericResponse = request.genericResponse?.rawResponseHex || "";

        const title = request.requestedFqn || `Waiting for wallet submission under ${request.parentFqn}`;
        const subtitle = request.requestedName
          ? `Requested ${request.requestedName} under ${request.parentFqn}`
          : `Scan the QR to let the wallet choose a name.`;

        setText(node, "title", title);
        setText(node, "subtitle", subtitle);
        setText(node, "status", request.status);
        setText(node, "automationState", humanizeState(automationState));
        setText(node, "commitmentSummary", commitmentStage(request));
        setText(node, "registrationSummary", registrationStage(request));
        setText(node, "genericResponseSummary", genericResponseStage(request));

        setCopyableText(node, "challengeId", request.challengeId);
        setCopyableText(node, "parentId", request.parentId);
        setCopyableText(node, "responseUri", request.responseUri, "Not requested");
        setCopyableText(
          node,
          "walletSigningAddress",
          request.walletSigningAddress,
          walletSigningAddress,
        );
        setCopyableText(
          node,
          "requestedIdentityAddress",
          request.requestedIdentityAddress,
          requestedIdentityAddress,
        );
        setCopyableText(node, "commitmentTxid", commitmentTxid, "Not submitted yet");
        setText(node, "commitmentConfirmationsDetail", formatCommitmentConfirmations(request));
        setCopyableText(node, "registrationTxid", registrationTxid, "Not submitted yet");
        setText(node, "lastResponseState", request.lastResponseState || "Not available");
        setCopyableText(
          node,
          "genericResponseSigner",
          genericResponseSigner,
          "Waiting for auth response",
        );
        setText(node, "genericResponseDetail", genericResponseDetail(request));
        setCopyableText(
          node,
          "rawGenericResponse",
          rawGenericResponse,
          "Waiting for auth response",
        );
        setText(node, "automationStateDetail", humanizeState(automationState));
        setText(node, "updatedAt", formatTimestamp(request.updatedAt));

        const error = node.querySelector("[data-field='automationError']");
        error.textContent = automationError;
        error.hidden = !automationError;

        const details = node.querySelector(".request-details");
        details.open = expandedRequests.has(request.challengeId);
        details.addEventListener("toggle", () => {
          if (details.open) {
            expandedRequests.add(request.challengeId);
          } else {
            expandedRequests.delete(request.challengeId);
          }
        });

        requestsList.appendChild(node);
      }
    } catch (error) {
      requestsList.innerHTML = `<p class="error">${error.message}</p>`;
    }
  };

  qrForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("Generating QR...");
    qrResult.hidden = true;

    try {
      const data = await fetchJson("/api/generate-provisioning-qr", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          parentId: parentSelect.value,
          webhookBaseUrl: webhookBaseUrlInput.value,
          responseUri: responseUriInput.value,
        }),
      });

      qrImage.src = data.qrDataUrl;
      deeplink.value = data.deeplink;
      qrResult.hidden = false;
      setStatus(`Generated request ${data.requestId}`);
      await renderRequests();
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  document.getElementById("refresh-parents").addEventListener("click", loadParents);
  document.getElementById("refresh-requests").addEventListener("click", renderRequests);
  webhookBaseUrlInput.addEventListener("input", syncDefaultResponseUri);

  document.querySelectorAll(".copy-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const target = document.getElementById(button.dataset.copyTarget);
      await copyText(target.value);
      button.textContent = "Copied";
      setTimeout(() => {
        button.textContent = "Copy deeplink";
      }, 1200);
    });
  });

  loadParents();
  renderRequests();
  setInterval(renderRequests, 5000);
})();
