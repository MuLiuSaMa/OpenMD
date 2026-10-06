# One definition, separate images for each distribution and test phase.
ARG BASE_IMAGE=ubuntu:24.04
FROM ${BASE_IMAGE} AS clean
ARG DISTRO=ubuntu
ENV TEST_DISTRO=${DISTRO}
COPY container.sh desktop.sh workflow.py /opt/linux-packaging/
ENTRYPOINT ["bash", "/opt/linux-packaging/container.sh"]

# Keep the large desktop tool layer cached when workflow scripts change.
FROM ${BASE_IMAGE} AS tools
ARG DISTRO=ubuntu
ENV TEST_DISTRO=${DISTRO}
COPY tools.sh /opt/linux-packaging/tools.sh
RUN bash /opt/linux-packaging/tools.sh

FROM tools AS desktop
COPY container.sh desktop.sh workflow.py /opt/linux-packaging/
ENTRYPOINT ["bash", "/opt/linux-packaging/container.sh"]
