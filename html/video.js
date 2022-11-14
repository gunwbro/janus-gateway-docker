// We import the settings.js file to know which address we should contact
// to talk to Janus, and optionally which STUN/TURN servers should be
// used as well. Specifically, that file defines the "server" and
// "iceServers" properties we'll pass when creating the Janus session.

const MAX_INTERVIEWER = 5;
var janus = null;
var sfutest = null;
var opaqueId = "videoroom-" + Janus.randomString(12);

var myroom = 1234; // Demo room
if (getQueryStringValue("room") !== "")
  myroom = parseInt(getQueryStringValue("room"));
var myusername = null;
var myid = null;
var mystream = null;
// We use this other ID just to map our subscriptions to us
var mypvtid = null;

var localTracks = {},
  localVideos = 0;
var feeds = [],
  feedStreams = {};
var bitrateTimer = [];

var doSimulcast =
  getQueryStringValue("simulcast") === "yes" ||
  getQueryStringValue("simulcast") === "true";
var acodec =
  getQueryStringValue("acodec") !== "" ? getQueryStringValue("acodec") : null;
var vcodec =
  getQueryStringValue("vcodec") !== "" ? getQueryStringValue("vcodec") : null;
var doDtx =
  getQueryStringValue("dtx") === "yes" || getQueryStringValue("dtx") === "true";
var subscriber_mode =
  getQueryStringValue("subscriber-mode") === "yes" ||
  getQueryStringValue("subscriber-mode") === "true";
var use_msid =
  getQueryStringValue("msid") === "yes" ||
  getQueryStringValue("msid") === "true";

$(document).ready(function () {
  // Initialize the library (all console debuggers enabled)
  Janus.init({
    debug: "all",
    callback: function () {
      // 면접관 입장
      $("#start, #start-ee").one("click", function () {
        $(this).attr("disabled", true).unbind("click");
        const isInterviewer = $(this).html().includes("면접관");
        const startId = isInterviewer ? "#start" : "#start-ee";
        const xstartId = isInterviewer ? "#start-ee" : "#start";
        const videoLocalHtmlId = isInterviewer ? "#videolocal" : "#video-ee";
        // WebRTC 지원하는 브라우저인지 체크
        if (!Janus.isWebrtcSupported()) {
          bootbox.alert("WebRTC가 지원되지 않는 브라우저 입니다.");
          return;
        }
        // 세션 생성
        janus = new Janus({
          server: server,
          iceServers: iceServers,
          // Should the Janus API require authentication, you can specify either the API secret or user token here too
          //		token: "mytoken",
          //	or
          //		apisecret: "serversecret",
          success: function () {
            // 비디오룸 플러그인 부착
            janus.attach({
              plugin: "janus.plugin.videoroom",
              opaqueId: opaqueId,
              success: function (pluginHandle) {
                // header 및 details 제거
                $("#header").remove();
                $("#details").remove();
                sfutest = pluginHandle;
                Janus.log(
                  "Plugin attached! (" +
                    sfutest.getPlugin() +
                    ", id=" +
                    sfutest.getId() +
                    ")"
                );
                Janus.log("  -- This is a publisher/manager");
                // 이름 입력창 띄우고, 클릭 이벤트 함수 부착
                $("#videojoin").removeClass("hide").show();
                $("#registernow").removeClass("hide").show();
                $("#register").click({ isInterviewer }, registerUsername);
                $("#username").focus();
                $(startId)
                  .removeAttr("disabled")
                  .html("중지")
                  .click(function () {
                    $(this).attr("disabled", true);
                    janus.destroy();
                  });
                $(xstartId).css("display", "none");
              },
              error: function (error) {
                Janus.error("  -- Error attaching plugin...", error);
                bootbox.alert("Error attaching plugin... " + error);
              },

              // 이 콜백은 getUserMedia가 호출되기 직전에 (파라미터=true)
              // 그리고 완료된 후에(파라미터=false) 트리거 된다.
              // 즉, 사용자에게 장치 액세스 동의 요청을 수락할 필요성을 알리기 위해
              // 이에 따라 UI를 수정하는 데 사용될 수 있음.
              consentDialog: function (on) {
                Janus.debug(
                  "Consent dialog should be " + (on ? "on" : "off") + " now"
                );
                if (on) {
                  // Darken screen and show hint
                  $.blockUI({
                    message: '<div><img src="up_arrow.png"/></div>',
                    css: {
                      border: "none",
                      padding: "15px",
                      backgroundColor: "transparent",
                      color: "#aaa",
                      top: "10px",
                      left: navigator.mozGetUserMedia ? "-100px" : "300px",
                    },
                  });
                } else {
                  // Restore screen
                  $.unblockUI();
                }
              },
              iceState: function (state) {
                Janus.log("ICE state changed to " + state);
              },
              mediaState: function (medium, on, mid) {
                Janus.log(
                  "Janus " +
                    (on ? "started" : "stopped") +
                    " receiving our " +
                    medium +
                    " (mid=" +
                    mid +
                    ")"
                );
              },
              webrtcState: function (on) {
                Janus.log(
                  "Janus says our WebRTC PeerConnection is " +
                    (on ? "up" : "down") +
                    " now"
                );
                // 모달 창 (처음 로딩 때 감싸지는 회색 창) 없애기
                $(videoLocalHtmlId).parent().parent().unblock();
                if (!on) return;
              },

              // Slow Link (네트워크가 500k/bps이하일 경우)
              slowLink: function (uplink, lost, mid) {
                Janus.warn(
                  "Janus reports problems " +
                    (uplink ? "sending" : "receiving") +
                    " packets on mid " +
                    mid +
                    " (" +
                    lost +
                    " lost packets)"
                );
              },

              onmessage: function (msg, jsep) {
                Janus.debug(" ::: Got a message (publisher) :::", msg);
                var event = msg["videoroom"];
                Janus.debug("Event: " + event);
                if (event) {
                  if (event === "joined") {
                    // 방 입장 (본인) 이벤트 발생 시
                    // Publisher/manager created, negotiate WebRTC and attach to existing feeds, if any
                    myid = msg["id"];
                    mypvtid = msg["private_id"];
                    Janus.log(
                      "Successfully joined room " +
                        msg["room"] +
                        " with ID " +
                        myid
                    );
                    if (subscriber_mode) {
                      $("#videojoin").hide();
                      $("#videos").removeClass("hide").show();
                    } else {
                      publishOwnFeed(true);
                    }
                    // Subscribe 할 Publisher 목록을 가져옴.
                    if (msg["publishers"]) {
                      var list = msg["publishers"];
                      Janus.debug(
                        "Got a list of available publishers/feeds:",
                        list
                      );
                      for (var f in list) {
                        if (list[f]["dummy"]) continue;
                        var id = list[f]["id"];
                        var streams = list[f]["streams"];
                        var display = list[f]["display"];

                        for (var i in streams) {
                          var stream = streams[i];
                          stream["id"] = id;
                          stream["display"] = display;
                        }
                        feedStreams[id] = streams;
                        Janus.debug(
                          "  >> [" + id + "] " + display + ":",
                          streams
                        );
                        newRemoteFeed(id, display, streams, isInterviewer);
                      }
                    }
                  } else if (event === "destroyed") {
                    // The room has been destroyed
                    Janus.warn("The room has been destroyed!");
                    bootbox.alert("The room has been destroyed", function () {
                      window.location.reload();
                    });
                  } else if (event === "event") {
                    // Any info on our streams or a new feed to attach to?
                    if (msg["streams"]) {
                      var streams = msg["streams"];
                      for (var i in streams) {
                        var stream = streams[i];
                        stream["id"] = myid;
                        stream["display"] = myusername;
                      }
                      feedStreams[myid] = streams;
                    } else if (msg["publishers"]) {
                      var list = msg["publishers"];
                      Janus.debug(
                        "Got a list of available publishers/feeds:",
                        list
                      );
                      for (var f in list) {
                        if (list[f]["dummy"]) continue;
                        var id = list[f]["id"];
                        var display = list[f]["display"];
                        var streams = list[f]["streams"];

                        for (var i in streams) {
                          var stream = streams[i];
                          stream["id"] = id;
                          stream["display"] = display;
                        }
                        feedStreams[id] = streams;
                        Janus.debug(
                          "  >> [" + id + "] " + display + ":",
                          streams
                        );
                        newRemoteFeed(id, display, streams, isInterviewer);
                      }
                    } else if (msg["leaving"]) {
                      // 본인(Subscriber)이 구독하고 있는 Publisher 중 한명이 나갔을 때
                      var leaving = msg["leaving"];
                      Janus.log("Publisher left: " + leaving);
                      var remoteFeed = null;
                      for (var i = 0; i < MAX_INTERVIEWER; i++) {
                        if (feeds[i] && feeds[i].rfid == leaving) {
                          remoteFeed = feeds[i];
                          break;
                        }
                      }
                      if (remoteFeed) {
                        const feedIndex = remoteFeed.rfindex;
                        const videoRemoteHtmlId =
                          remoteFeed.rfdisplay.substr(0, 2) === "ee"
                            ? `#video-ee`
                            : `#videoremote${feedIndex}`;
                        const remoteHtmlId =
                          remoteFeed.rfdisplay.substr(0, 2) === "ee"
                            ? `#remote-ee`
                            : `#remote${feedIndex}`;

                        Janus.debug(
                          "Feed " +
                            remoteFeed.rfid +
                            " (" +
                            remoteFeed.rfdisplay +
                            ") has left the room, detaching"
                        );
                        $(remoteHtmlId).empty().hide();
                        $(videoRemoteHtmlId).empty();
                        feeds[remoteFeed.rfindex] = null;
                        remoteFeed.detach();
                      }
                      delete feedStreams[leaving];
                    } else if (msg["unpublished"]) {
                      // 본인(Subscriber)이 구독하고 있는 Publisher 중 한명이 Publish 를 종료 했을 때
                      var unpublished = msg["unpublished"];
                      Janus.log("Publisher left: " + unpublished);
                      if (unpublished === "ok") {
                        // 본인이 Unpublish 한 경우
                        sfutest.hangup(); // PeerConnection 을 끊음
                        return;
                      }
                      var remoteFeed = null;
                      for (var i = 0; i < MAX_INTERVIEWER; i++) {
                        if (feeds[i] && feeds[i].rfid == unpublished) {
                          remoteFeed = feeds[i];
                          break;
                        }
                      }
                      if (remoteFeed) {
                        const feedIndex = remoteFeed.rfindex;
                        const videoRemoteHtmlId =
                          remoteFeed.rfdisplay.substr(0, 2) === "ee"
                            ? `#video-ee`
                            : `#videoremote${feedIndex}`;
                        const remoteHtmlId =
                          remoteFeed.rfdisplay.substr(0, 2) === "ee"
                            ? `#remote-ee`
                            : `#remote${feedIndex}`;

                        Janus.debug(
                          "Feed " +
                            remoteFeed.rfid +
                            " (" +
                            remoteFeed.rfdisplay +
                            ") has left the room, detaching"
                        );
                        $(remoteHtmlId).empty().hide();
                        $(videoRemoteHtmlId).empty();
                        feeds[remoteFeed.rfindex] = null;
                        remoteFeed.detach();
                      }
                      delete feedStreams[unpublished];
                    } else if (msg["error"]) {
                      if (msg["error_code"] === 426) {
                        // This is a "no such room" error: give a more meaningful description
                        bootbox.alert(
                          "<p>Apparently room <code>" +
                            myroom +
                            "</code> (the one this demo uses as a test room) " +
                            "does not exist...</p><p>Do you have an updated <code>janus.plugin.videoroom.jcfg</code> " +
                            "configuration file? If not, make sure you copy the details of room <code>" +
                            myroom +
                            "</code> " +
                            "from that sample in your current configuration file, then restart Janus and try again."
                        );
                      } else {
                        bootbox.alert(msg["error"]);
                      }
                    }
                  }
                }
                if (jsep) {
                  const videoLocal = Janus.debug(
                    "Handling SDP as well...",
                    jsep
                  );
                  sfutest.handleRemoteJsep({ jsep: jsep });
                  // Check if any of the media we wanted to publish has
                  // been rejected (e.g., wrong or unsupported codec)
                  var audio = msg["audio_codec"];
                  if (
                    mystream &&
                    mystream.getAudioTracks() &&
                    mystream.getAudioTracks().length > 0 &&
                    !audio
                  ) {
                    // Audio has been rejected
                    toastr.warning(
                      "Our audio stream has been rejected, viewers won't hear us"
                    );
                  }
                  var video = msg["video_codec"];
                  if (
                    mystream &&
                    mystream.getVideoTracks() &&
                    mystream.getVideoTracks().length > 0 &&
                    !video
                  ) {
                    // Video has been rejected
                    toastr.warning(
                      "Our video stream has been rejected, viewers won't see us"
                    );
                    // Hide the webcam video
                    $("#myvideo").hide();
                    $(videoLocalHtmlId).append(
                      '<div class="no-video-container">' +
                        '<i class="fa fa-video-camera fa-5 no-video-icon" style="height: 100%;"></i>' +
                        '<span class="no-video-text" style="font-size: 16px;">Video rejected, no webcam</span>' +
                        "</div>"
                    );
                  }
                }
              },
              onlocaltrack: function (track, on) {
                Janus.debug(
                  "Local track " + (on ? "added" : "removed") + ":",
                  track
                );
                // We use the track ID as name of the element, but it may contain invalid characters
                var trackId = track.id.replace(/[{}]/g, "");
                if (!on) {
                  // Track removed, get rid of the stream and the rendering
                  var stream = localTracks[trackId];
                  if (stream) {
                    try {
                      var tracks = stream.getTracks();
                      for (var i in tracks) {
                        var mst = tracks[i];
                        if (mst !== null && mst !== undefined) mst.stop();
                      }
                    } catch (e) {}
                  }
                  if (track.kind === "video") {
                    $("#myvideo" + trackId).remove();
                    localVideos--;
                    if (localVideos === 0) {
                      // No video, at least for now: show a placeholder
                      if (
                        $(`${videoLocalHtmlId} .no-video-container`).length ===
                        0
                      ) {
                        $(videoLocalHtmlId).append(
                          '<div class="no-video-container">' +
                            '<i class="fa fa-video-camera fa-5 no-video-icon"></i>' +
                            '<span class="no-video-text">No webcam available</span>' +
                            "</div>"
                        );
                      }
                    }
                  }
                  delete localTracks[trackId];
                  return;
                }
                // If we're here, a new track was added
                var stream = localTracks[trackId];
                if (stream) {
                  // We've been here already
                  return;
                }
                $("#videos").removeClass("hide").show();
                if ($("#mute").length === 0) {
                  // Add a 'mute' button
                  $("#buttonSet").append(
                    '<button class="bsbtn" id="mute" style="">음소거</button>'
                  );
                  $("#mute").click(toggleMute);
                  // Add an 'unpublish' button
                  $("#buttonSet").append(
                    '<button class="bsbtn" id="unpublish" style=""; margin: 15px;">비디오 종료</button>'
                  );
                  $("#unpublish").click(toggleVideoMute);
                }
                if (track.kind === "audio") {
                  // We ignore local audio tracks, they'd generate echo anyway
                  if (localVideos === 0) {
                    // No video, at least for now: show a placeholder
                    if (
                      $(`${videoLocalHtmlId} .no-video-container`).length === 0
                    ) {
                      $(videoLocalHtmlId).append(
                        '<div class="no-video-container">' +
                          '<i class="fa fa-video-camera fa-5 no-video-icon"></i>' +
                          '<span class="no-video-text">No webcam available</span>' +
                          "</div>"
                      );
                    }
                  }
                } else {
                  // New video track: create a stream out of it
                  localVideos++;
                  $(`${videoLocalHtmlId} .no-video-container`).remove();
                  stream = new MediaStream([track]);
                  localTracks[trackId] = stream;
                  Janus.log("Created local stream:", stream);
                  Janus.log(stream.getTracks());
                  Janus.log(stream.getVideoTracks());
                  $(videoLocalHtmlId).append(
                    '<video class="rounded centered" id="myvideo' +
                      trackId +
                      '" width=100% autoplay playsinline muted="muted"/>'
                  );
                  Janus.attachMediaStream(
                    $("#myvideo" + trackId).get(0),
                    stream
                  );
                }
                if (
                  sfutest.webrtcStuff.pc.iceConnectionState !== "completed" &&
                  sfutest.webrtcStuff.pc.iceConnectionState !== "connected"
                ) {
                  $(videoLocalHtmlId)
                    .parent()
                    .parent()
                    .block({
                      message: "<b>Publishing...</b>",
                      css: {
                        border: "none",
                        backgroundColor: "transparent",
                        color: "white",
                      },
                    });
                }
              },
              onremotetrack: function (track, mid, on) {
                // The publisher stream is sendonly, we don't expect anything here
              },
              oncleanup: function () {
                Janus.log(
                  " ::: Got a cleanup notification: we are unpublished now :::"
                );
                mystream = null;
                delete feedStreams[myid];
                $(videoLocalHtmlId).html("");
                $("#buttonSet").html(
                  '<button class="bsbtn" id="publish" class="btn btn-primary">비디오 켜기</button>'
                );
                $("#publish").click(function () {
                  publishOwnFeed(true);
                });
                $(videoLocalHtmlId).parent().parent().unblock();
                $("#bitrate").parent().parent().addClass("hide");
                $("#bitrate a").unbind("click");
                localTracks = {};
                localVideos = 0;
              },
            });
          },
          error: function (error) {
            Janus.error(error);
            bootbox.alert(error, function () {
              window.location.reload();
            });
          },
          destroyed: function () {
            window.location.reload();
          },
        });
      });
    },
  });
});

function registerUsername(event) {
  const { isInterviewer } = event.data;
  const remoteHtmlId = isInterviewer ? `#publisher` : `#remote-ee`;
  if ($("#username").length === 0) {
    // Create fields to register
    $("#register").click(registerUsername);
    $("#username").focus();
  } else {
    // Try a registration
    $("#username").attr("disabled", true);
    $("#register").attr("disabled", true).unbind("click");
    $("#videojoin").css("display", "none");
    var username = $("#username").val();
    if (username === "") {
      $("#you")
        .removeClass()
        .addClass("label label-warning")
        .html("Insert your display name (e.g., pippo)");
      $("#username").removeAttr("disabled");
      $("#register").removeAttr("disabled").click(registerUsername);
      return;
    }

    const nameWithPrefix = isInterviewer ? `er-${username}` : `ee-${username}`;

    $(remoteHtmlId).removeClass("hide").html(username).show();

    if (!isInterviewer) {
      $("#localcol").remove();
      $("#lastrow").append(
        `<div class="col-md-4">
        <div class="panel panel-default">
          <div class="panel-heading">
            <span class="participant-name hide" id="remote5"></span>

            <h3 class="panel-title">(면접관)</h3>
          </div>
          <div class="panel-body relative" id="videoremote5"></div>
        </div>
      </div>`
      );
    }
    var register = {
      request: "join",
      room: myroom,
      ptype: "publisher",
      display: nameWithPrefix,
    };
    myusername = escapeXmlTags(nameWithPrefix);
    sfutest.send({ message: register });
  }
}

// 본인의 Stream 을 Publish 함
function publishOwnFeed(useAudio) {
  // Publish our stream
  $("#publish").attr("disabled", true).unbind("click");
  $("#publish").hide();
  // We want sendonly audio and video (uncomment the data track
  // too if you want to publish via datachannels as well)
  let tracks = [];
  if (useAudio) tracks.push({ type: "audio", capture: true, recv: false });
  tracks.push({
    type: "video",
    capture: true,
    recv: false,
    simulcast: doSimulcast,
  });
  //~ tracks.push({ type: 'data' });

  sfutest.createOffer({
    tracks: tracks,
    customizeSdp: function (jsep) {
      // If DTX is enabled, munge the SDP
      if (doDtx) {
        jsep.sdp = jsep.sdp.replace(
          "useinbandfec=1",
          "useinbandfec=1;usedtx=1"
        );
      }
    },
    success: function (jsep) {
      Janus.log("Got publisher SDP!", jsep);
      var publish = { request: "configure", audio: useAudio, video: true };
      // You can force a specific codec to use when publishing by using the
      // audiocodec and videocodec properties, for instance:
      // 		publish["audiocodec"] = "opus"
      // to force Opus as the audio codec to use, or:
      // 		publish["videocodec"] = "vp9"
      // to force VP9 as the videocodec to use. In both case, though, forcing
      // a codec will only work if: (1) the codec is actually in the SDP (and
      // so the browser supports it), and (2) the codec is in the list of
      // allowed codecs in a room. With respect to the point (2) above,
      // refer to the text in janus.plugin.videoroom.jcfg for more details.
      // We allow people to specify a codec via query string, for demo purposes
      if (acodec) publish["audiocodec"] = acodec;
      if (vcodec) publish["videocodec"] = vcodec;
      sfutest.send({ message: publish, jsep: jsep });
    },
    error: function (error) {
      Janus.error("WebRTC error:", error);
      if (useAudio) {
        publishOwnFeed(false);
      } else {
        bootbox.alert("WebRTC error... " + error.message);
        $("#publish")
          .removeAttr("disabled")
          .click(function () {
            publishOwnFeed(true);
          });
      }
    },
  });
}

function toggleMute() {
  var muted = sfutest.isAudioMuted();
  Janus.log((muted ? "Unmuting" : "Muting") + " local audio stream...");
  if (muted) sfutest.unmuteAudio();
  else sfutest.muteAudio();
  muted = sfutest.isAudioMuted();
  $("#mute").html(muted ? "음소거 해제" : "음소거");
}

function toggleVideoMute() {
  let muted = sfutest.isVideoMuted();
  Janus.log((muted ? "Unmuting" : "Muting") + " local video stream...");
  if (muted) sfutest.unmuteVideo();
  else sfutest.muteVideo();
  muted = sfutest.isVideoMuted();
  $("#unpublish").html(muted ? "비디오 켜기" : "비디오 끄기");
}

function unpublishOwnFeed() {
  // Unpublish our stream
  $("#unpublish").attr("disabled", true).unbind("click");
  var unpublish = { request: "unpublish" };
  sfutest.send({ message: unpublish });
}

function newRemoteFeed(id, display, streams, isInterviewer) {
  // A new feed has been published, create a new plugin handle and attach to it as a subscriber
  var remoteFeed = null;

  if (!streams) streams = feedStreams[id];
  janus.attach({
    plugin: "janus.plugin.videoroom",
    opaqueId: opaqueId,
    success: function (pluginHandle) {
      remoteFeed = pluginHandle;
      remoteFeed.remoteTracks = {};
      remoteFeed.remoteVideos = 0;
      remoteFeed.simulcastStarted = false;
      Janus.log(
        "Plugin attached! (" +
          remoteFeed.getPlugin() +
          ", id=" +
          remoteFeed.getId() +
          ")"
      );
      Janus.log("  -- This is a subscriber");
      // Prepare the streams to subscribe to, as an array: we have the list of
      // streams the feed is publishing, so we can choose what to pick or skip
      var subscription = [];
      for (var i in streams) {
        var stream = streams[i];
        // If the publisher is VP8/VP9 and this is an older Safari, let's avoid video
        if (
          stream.type === "video" &&
          Janus.webRTCAdapter.browserDetails.browser === "safari" &&
          (stream.codec === "vp9" ||
            (stream.codec === "vp8" && !Janus.safariVp8))
        ) {
          toastr.warning(
            "Publisher is using " +
              stream.codec.toUpperCase +
              ", but Safari doesn't support it: disabling video stream #" +
              stream.mindex
          );
          continue;
        }
        subscription.push({
          feed: stream.id, // This is mandatory
          mid: stream.mid, // This is optional (all streams, if missing)
        });
        // FIXME Right now, this is always the same feed: in the future, it won't
        remoteFeed.rfid = stream.id;
        remoteFeed.rfdisplay = escapeXmlTags(stream.display);
      }
      // We wait for the plugin to send us an offer
      var subscribe = {
        request: "join",
        room: myroom,
        ptype: "subscriber",
        streams: subscription,
        use_msid: use_msid,
        private_id: mypvtid,
      };
      remoteFeed.send({ message: subscribe });
    },
    error: function (error) {
      Janus.error("  -- Error attaching plugin...", error);
      bootbox.alert("Error attaching plugin... " + error);
    },
    iceState: function (state) {
      Janus.log(
        "ICE state (feed #" + remoteFeed.rfindex + ") changed to " + state
      );
    },
    webrtcState: function (on) {
      Janus.log(
        "Janus says this WebRTC PeerConnection (feed #" +
          remoteFeed.rfindex +
          ") is " +
          (on ? "up" : "down") +
          " now"
      );
    },
    slowLink: function (uplink, lost, mid) {
      Janus.warn(
        "Janus reports problems " +
          (uplink ? "sending" : "receiving") +
          " packets on mid " +
          mid +
          " (" +
          lost +
          " lost packets)"
      );
    },
    onmessage: function (msg, jsep) {
      Janus.debug(" ::: Got a message (subscriber) :::", msg);
      var event = msg["videoroom"];
      Janus.debug("Event: " + event);
      if (msg["error"]) {
        bootbox.alert(msg["error"]);
      } else if (event) {
        if (event === "attached") {
          // Subscriber created and attached
          for (var i = 1; i < MAX_INTERVIEWER; i++) {
            if (remoteFeed.rfdisplay.substr(0, 2) === "ee") {
              feeds[0] = remoteFeed;
              remoteFeed.rfindex = 0;
              break;
            }
            if (!feeds[i]) {
              feeds[i] = remoteFeed;
              remoteFeed.rfindex = i;
              break;
            }
          }
          const feedIndex = remoteFeed.rfindex;
          const remoteHtmlId =
            remoteFeed.rfdisplay.substr(0, 2) === "ee"
              ? `#remote-ee`
              : `#remote${feedIndex}`;
          if (!remoteFeed.spinner) {
            var target = document.getElementById(remoteFeed.rfindex);
            remoteFeed.spinner = new Spinner({ top: 100 }).spin(target);
          } else {
            remoteFeed.spinner.spin();
          }
          Janus.log("Successfully attached to feed in room " + msg["room"]);
          $(remoteHtmlId)
            .removeClass("hide")
            .html(remoteFeed.rfdisplay.substr(3))
            .show();
        } else if (event === "event") {
          // Check if we got a simulcast-related event from this publisher
          var substream = msg["substream"];
          var temporal = msg["temporal"];
          if (
            (substream !== null && substream !== undefined) ||
            (temporal !== null && temporal !== undefined)
          ) {
            if (!remoteFeed.simulcastStarted) {
              remoteFeed.simulcastStarted = true;
              // Add some new buttons
              addSimulcastButtons(
                remoteFeed.rfindex,
                remoteFeed.rfdisplay,
                true
              );
            }
            // We just received notice that there's been a switch, update the buttons
            updateSimulcastButtons(remoteFeed.rfindex, substream, temporal);
          }
        } else {
          // What has just happened?
        }
      }
      if (jsep) {
        Janus.debug("Handling SDP as well...", jsep);
        var stereo = jsep.sdp.indexOf("stereo=1") !== -1;
        // Answer and attach
        remoteFeed.createAnswer({
          jsep: jsep,
          // We only specify data channels here, as this way in
          // case they were offered we'll enable them. Since we
          // don't mention audio or video tracks, we autoaccept them
          // as recvonly (since we won't capture anything ourselves)
          tracks: [{ type: "data" }],
          customizeSdp: function (jsep) {
            if (stereo && jsep.sdp.indexOf("stereo=1") == -1) {
              // Make sure that our offer contains stereo too
              jsep.sdp = jsep.sdp.replace(
                "useinbandfec=1",
                "useinbandfec=1;stereo=1"
              );
            }
          },
          success: function (jsep) {
            Janus.debug("Got SDP!", jsep);
            var body = { request: "start", room: myroom };
            remoteFeed.send({ message: body, jsep: jsep });
          },
          error: function (error) {
            Janus.error("WebRTC error:", error);
            bootbox.alert("WebRTC error... " + error.message);
          },
        });
      }
    },
    onlocaltrack: function (track, on) {
      // The subscriber stream is recvonly, we don't expect anything here
    },
    onremotetrack: function (track, mid, on) {
      const feedIndex = remoteFeed.rfindex;
      const videoRemoteHtmlId =
        display.substr(0, 2) === "ee"
          ? `#video-ee`
          : `#videoremote${feedIndex}`;
      Janus.debug(
        "Remote feed #" +
          feedIndex +
          ", remote track (mid=" +
          mid +
          ") " +
          (on ? "added" : "removed") +
          ":",
        track
      );
      if (!on) {
        // Track removed, get rid of the stream and the rendering
        $("#remotevideo" + feedIndex + "-" + mid).remove();
        if (track.kind === "video") {
          remoteFeed.remoteVideos--;
          if (remoteFeed.remoteVideos === 0) {
            // No video, at least for now: show a placeholder
            if ($(videoRemoteHtmlId + " .no-video-container").length === 0) {
              $(videoRemoteHtmlId).append(
                '<div class="no-video-container">' +
                  '<i class="fa fa-video-camera fa-5 no-video-icon"></i>' +
                  '<span class="no-video-text">No remote video available</span>' +
                  "</div>"
              );
            }
          }
        }
        delete remoteFeed.remoteTracks[mid];
        return;
      }
      // If we're here, a new track was added
      if (remoteFeed.spinner) {
        remoteFeed.spinner.stop();
        remoteFeed.spinner = null;
      }
      if ($("#remotevideo" + feedIndex + "-" + mid).length > 0) return;
      if (track.kind === "audio") {
        // New audio track: create a stream out of it, and use a hidden <audio> element
        stream = new MediaStream([track]);
        remoteFeed.remoteTracks[mid] = stream;
        Janus.log("Created remote audio stream:", stream);
        $(videoRemoteHtmlId).append(
          '<audio class="hide" id="remotevideo' +
            feedIndex +
            "-" +
            mid +
            '" autoplay playsinline/>'
        );
        Janus.attachMediaStream(
          $("#remotevideo" + feedIndex + "-" + mid).get(0),
          stream
        );
        if (remoteFeed.remoteVideos === 0) {
          // No video, at least for now: show a placeholder
          if ($(videoRemoteHtmlId + " .no-video-container").length === 0) {
            $(videoRemoteHtmlId).append(
              '<div class="no-video-container">' +
                '<i class="fa fa-video-camera fa-5 no-video-icon"></i>' +
                '<span class="no-video-text">No remote video available</span>' +
                "</div>"
            );
          }
        }
      } else {
        // New video track: create a stream out of it
        remoteFeed.remoteVideos++;
        $(videoRemoteHtmlId + " .no-video-container").remove();
        stream = new MediaStream([track]);
        remoteFeed.remoteTracks[mid] = stream;
        Janus.log("Created remote video stream:", stream);
        $(videoRemoteHtmlId).append(
          '<video class="rounded centered" id="remotevideo' +
            feedIndex +
            "-" +
            mid +
            '" width=100% autoplay playsinline/>'
        );
        $(videoRemoteHtmlId).append(
          '<span class="label label-primary hide" id="curres' +
            feedIndex +
            '" style="position: absolute; bottom: 0px; left: 0px; margin: 15px;"></span>' +
            '<span class="label label-info hide" id="curbitrate' +
            feedIndex +
            '" style="position: absolute; bottom: 0px; right: 0px; margin: 15px;"></span>'
        );
        Janus.attachMediaStream(
          $("#remotevideo" + feedIndex + "-" + mid).get(0),
          stream
        );
        // Note: we'll need this for additional videos too
        if (!bitrateTimer[feedIndex]) {
          $("#curbitrate" + feedIndex)
            .removeClass("hide")
            .show();
          bitrateTimer[feedIndex] = setInterval(function () {
            if (!$(videoRemoteHtmlId + " video").get(0)) return;
            // Display updated bitrate, if supported
            var bitrate = remoteFeed.getBitrate();
            $("#curbitrate" + feedIndex).text(bitrate);
            // Check if the resolution changed too
            var width = $(videoRemoteHtmlId + " video").get(0).videoWidth;
            var height = $(videoRemoteHtmlId + " video").get(0).videoHeight;
            if (width > 0 && height > 0)
              $("#curres" + feedIndex)
                .removeClass("hide")
                .text(width + "x" + height)
                .show();
          }, 1000);
        }
      }
    },
    oncleanup: function () {
      Janus.log(" ::: Got a cleanup notification (remote feed " + id + ") :::");
      if (remoteFeed.spinner) remoteFeed.spinner.stop();
      remoteFeed.spinner = null;
      $("#remotevideo" + remoteFeed.rfindex).remove();
      $("#waitingvideo" + remoteFeed.rfindex).remove();
      $("#novideo" + remoteFeed.rfindex).remove();
      $("#curbitrate" + remoteFeed.rfindex).remove();
      $("#curres" + remoteFeed.rfindex).remove();
      if (bitrateTimer[remoteFeed.rfindex])
        clearInterval(bitrateTimer[remoteFeed.rfindex]);
      bitrateTimer[remoteFeed.rfindex] = null;
      remoteFeed.simulcastStarted = false;
      $("#simulcast" + remoteFeed.rfindex).remove();
      remoteFeed.remoteTracks = {};
      remoteFeed.remoteVideos = 0;
    },
  });
}

// Helper to parse query string
function getQueryStringValue(name) {
  name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
  var regex = new RegExp("[\\?&]" + name + "=([^&#]*)"),
    results = regex.exec(location.search);
  return results === null
    ? ""
    : decodeURIComponent(results[1].replace(/\+/g, " "));
}

// Helper to escape XML tags
function escapeXmlTags(value) {
  if (value) {
    var escapedValue = value.replace(new RegExp("<", "g"), "&lt");
    escapedValue = escapedValue.replace(new RegExp(">", "g"), "&gt");
    return escapedValue;
  }
}

// Helpers to create Simulcast-related UI, if enabled
function addSimulcastButtons(feed, display, temporal) {
  var index = feed;
  $("#remote" + index)
    .parent()
    .append(
      '<div id="simulcast' +
        index +
        '" class="btn-group-vertical btn-group-vertical-xs pull-right">' +
        '	<div class"row">' +
        '		<div class="btn-group btn-group-xs" style="width: 100%">' +
        '			<button id="sl' +
        index +
        '-2" type="button" class="btn btn-primary" data-toggle="tooltip" title="Switch to higher quality" style="width: 33%">SL 2</button>' +
        '			<button id="sl' +
        index +
        '-1" type="button" class="btn btn-primary" data-toggle="tooltip" title="Switch to normal quality" style="width: 33%">SL 1</button>' +
        '			<button id="sl' +
        index +
        '-0" type="button" class="btn btn-primary" data-toggle="tooltip" title="Switch to lower quality" style="width: 34%">SL 0</button>' +
        "		</div>" +
        "	</div>" +
        '	<div class"row">' +
        '		<div class="btn-group btn-group-xs hide" style="width: 100%">' +
        '			<button id="tl' +
        index +
        '-2" type="button" class="btn btn-primary" data-toggle="tooltip" title="Cap to temporal layer 2" style="width: 34%">TL 2</button>' +
        '			<button id="tl' +
        index +
        '-1" type="button" class="btn btn-primary" data-toggle="tooltip" title="Cap to temporal layer 1" style="width: 33%">TL 1</button>' +
        '			<button id="tl' +
        index +
        '-0" type="button" class="btn btn-primary" data-toggle="tooltip" title="Cap to temporal layer 0" style="width: 33%">TL 0</button>' +
        "		</div>" +
        "	</div>" +
        "</div>"
    );
  if (Janus.webRTCAdapter.browserDetails.browser !== "firefox") {
    // Chromium-based browsers only have two temporal layers
    $("#tl" + index + "-2").remove();
    $("#tl" + index + "-1").css("width", "50%");
    $("#tl" + index + "-0").css("width", "50%");
  }
  // Enable the simulcast selection buttons
  $("#sl" + index + "-0")
    .removeClass("btn-primary btn-success")
    .addClass("btn-primary")
    .unbind("click")
    .click(function () {
      toastr.info(
        "Switching simulcast substream, wait for it... (lower quality)",
        null,
        { timeOut: 2000 }
      );
      if (!$("#sl" + index + "-2").hasClass("btn-success"))
        $("#sl" + index + "-2")
          .removeClass("btn-primary btn-info")
          .addClass("btn-primary");
      if (!$("#sl" + index + "-1").hasClass("btn-success"))
        $("#sl" + index + "-1")
          .removeClass("btn-primary btn-info")
          .addClass("btn-primary");
      $("#sl" + index + "-0")
        .removeClass("btn-primary btn-info btn-success")
        .addClass("btn-info");
      feeds[index].send({ message: { request: "configure", substream: 0 } });
    });
  $("#sl" + index + "-1")
    .removeClass("btn-primary btn-success")
    .addClass("btn-primary")
    .unbind("click")
    .click(function () {
      toastr.info(
        "Switching simulcast substream, wait for it... (normal quality)",
        null,
        { timeOut: 2000 }
      );
      if (!$("#sl" + index + "-2").hasClass("btn-success"))
        $("#sl" + index + "-2")
          .removeClass("btn-primary btn-info")
          .addClass("btn-primary");
      $("#sl" + index + "-1")
        .removeClass("btn-primary btn-info btn-success")
        .addClass("btn-info");
      if (!$("#sl" + index + "-0").hasClass("btn-success"))
        $("#sl" + index + "-0")
          .removeClass("btn-primary btn-info")
          .addClass("btn-primary");
      feeds[index].send({ message: { request: "configure", substream: 1 } });
    });
  $("#sl" + index + "-2")
    .removeClass("btn-primary btn-success")
    .addClass("btn-primary")
    .unbind("click")
    .click(function () {
      toastr.info(
        "Switching simulcast substream, wait for it... (higher quality)",
        null,
        { timeOut: 2000 }
      );
      $("#sl" + index + "-2")
        .removeClass("btn-primary btn-info btn-success")
        .addClass("btn-info");
      if (!$("#sl" + index + "-1").hasClass("btn-success"))
        $("#sl" + index + "-1")
          .removeClass("btn-primary btn-info")
          .addClass("btn-primary");
      if (!$("#sl" + index + "-0").hasClass("btn-success"))
        $("#sl" + index + "-0")
          .removeClass("btn-primary btn-info")
          .addClass("btn-primary");
      feeds[index].send({ message: { request: "configure", substream: 2 } });
    });
  if (!temporal)
    // No temporal layer support
    return;
  $("#tl" + index + "-0")
    .parent()
    .removeClass("hide");
  $("#tl" + index + "-0")
    .removeClass("btn-primary btn-success")
    .addClass("btn-primary")
    .unbind("click")
    .click(function () {
      toastr.info(
        "Capping simulcast temporal layer, wait for it... (lowest FPS)",
        null,
        { timeOut: 2000 }
      );
      if (!$("#tl" + index + "-2").hasClass("btn-success"))
        $("#tl" + index + "-2")
          .removeClass("btn-primary btn-info")
          .addClass("btn-primary");
      if (!$("#tl" + index + "-1").hasClass("btn-success"))
        $("#tl" + index + "-1")
          .removeClass("btn-primary btn-info")
          .addClass("btn-primary");
      $("#tl" + index + "-0")
        .removeClass("btn-primary btn-info btn-success")
        .addClass("btn-info");
      feeds[index].send({ message: { request: "configure", temporal: 0 } });
    });
  $("#tl" + index + "-1")
    .removeClass("btn-primary btn-success")
    .addClass("btn-primary")
    .unbind("click")
    .click(function () {
      toastr.info(
        "Capping simulcast temporal layer, wait for it... (medium FPS)",
        null,
        { timeOut: 2000 }
      );
      if (!$("#tl" + index + "-2").hasClass("btn-success"))
        $("#tl" + index + "-2")
          .removeClass("btn-primary btn-info")
          .addClass("btn-primary");
      $("#tl" + index + "-1")
        .removeClass("btn-primary btn-info")
        .addClass("btn-info");
      if (!$("#tl" + index + "-0").hasClass("btn-success"))
        $("#tl" + index + "-0")
          .removeClass("btn-primary btn-info")
          .addClass("btn-primary");
      feeds[index].send({ message: { request: "configure", temporal: 1 } });
    });
  $("#tl" + index + "-2")
    .removeClass("btn-primary btn-success")
    .addClass("btn-primary")
    .unbind("click")
    .click(function () {
      toastr.info(
        "Capping simulcast temporal layer, wait for it... (highest FPS)",
        null,
        { timeOut: 2000 }
      );
      $("#tl" + index + "-2")
        .removeClass("btn-primary btn-info btn-success")
        .addClass("btn-info");
      if (!$("#tl" + index + "-1").hasClass("btn-success"))
        $("#tl" + index + "-1")
          .removeClass("btn-primary btn-info")
          .addClass("btn-primary");
      if (!$("#tl" + index + "-0").hasClass("btn-success"))
        $("#tl" + index + "-0")
          .removeClass("btn-primary btn-info")
          .addClass("btn-primary");
      feeds[index].send({ message: { request: "configure", temporal: 2 } });
    });
}

function updateSimulcastButtons(feed, substream, temporal) {
  // Check the substream
  var index = feed;
  if (substream === 0) {
    toastr.success("Switched simulcast substream! (lower quality)", null, {
      timeOut: 2000,
    });
    $("#sl" + index + "-2")
      .removeClass("btn-primary btn-success")
      .addClass("btn-primary");
    $("#sl" + index + "-1")
      .removeClass("btn-primary btn-success")
      .addClass("btn-primary");
    $("#sl" + index + "-0")
      .removeClass("btn-primary btn-info btn-success")
      .addClass("btn-success");
  } else if (substream === 1) {
    toastr.success("Switched simulcast substream! (normal quality)", null, {
      timeOut: 2000,
    });
    $("#sl" + index + "-2")
      .removeClass("btn-primary btn-success")
      .addClass("btn-primary");
    $("#sl" + index + "-1")
      .removeClass("btn-primary btn-info btn-success")
      .addClass("btn-success");
    $("#sl" + index + "-0")
      .removeClass("btn-primary btn-success")
      .addClass("btn-primary");
  } else if (substream === 2) {
    toastr.success("Switched simulcast substream! (higher quality)", null, {
      timeOut: 2000,
    });
    $("#sl" + index + "-2")
      .removeClass("btn-primary btn-info btn-success")
      .addClass("btn-success");
    $("#sl" + index + "-1")
      .removeClass("btn-primary btn-success")
      .addClass("btn-primary");
    $("#sl" + index + "-0")
      .removeClass("btn-primary btn-success")
      .addClass("btn-primary");
  }
  // Check the temporal layer
  if (temporal === 0) {
    toastr.success("Capped simulcast temporal layer! (lowest FPS)", null, {
      timeOut: 2000,
    });
    $("#tl" + index + "-2")
      .removeClass("btn-primary btn-success")
      .addClass("btn-primary");
    $("#tl" + index + "-1")
      .removeClass("btn-primary btn-success")
      .addClass("btn-primary");
    $("#tl" + index + "-0")
      .removeClass("btn-primary btn-info btn-success")
      .addClass("btn-success");
  } else if (temporal === 1) {
    toastr.success("Capped simulcast temporal layer! (medium FPS)", null, {
      timeOut: 2000,
    });
    $("#tl" + index + "-2")
      .removeClass("btn-primary btn-success")
      .addClass("btn-primary");
    $("#tl" + index + "-1")
      .removeClass("btn-primary btn-info btn-success")
      .addClass("btn-success");
    $("#tl" + index + "-0")
      .removeClass("btn-primary btn-success")
      .addClass("btn-primary");
  } else if (temporal === 2) {
    toastr.success("Capped simulcast temporal layer! (highest FPS)", null, {
      timeOut: 2000,
    });
    $("#tl" + index + "-2")
      .removeClass("btn-primary btn-info btn-success")
      .addClass("btn-success");
    $("#tl" + index + "-1")
      .removeClass("btn-primary btn-success")
      .addClass("btn-primary");
    $("#tl" + index + "-0")
      .removeClass("btn-primary btn-success")
      .addClass("btn-primary");
  }
}
